/* rolex-qmi.c — QMI kecil lewat QRTR untuk rolex (msm8917), tanpa libqmi.
 *
 * Kenapa: qmicli 1.32.4 di rootfs OpenWrt dibangun tanpa
 * HAVE_QMI_MESSAGE_UIM_CHANGE_PROVISIONING_SESSION, dan bind data port (wajib di SoC
 * bam-dmux: "bind a given data connection to a specific network interface") serta
 * Set IP Family harus di klien WDS yang SAMA dengan Start Network — qmicli hanya
 * boleh satu aksi per service per pemanggilan.
 *
 * Pakai:
 *   rolex-qmi uim  [slot] [session_type] [activate] [aid_hex]
 *   rolex-qmi data [apn] [iface] [mux]
 *   rolex-qmi wds-status
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <errno.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <linux/qrtr.h>

#define SVC_WDS 0x01
#define SVC_UIM 0x0b

#define MSG_UIM_CHANGE_SESSION 0x0038
#define MSG_WDS_BIND_MUX_PORT  0x00A2
#define MSG_WDS_SET_IP_FAMILY  0x004D
#define MSG_WDS_START_NETWORK  0x0020
#define MSG_WDS_GET_CUR_SET    0x002D
#define MSG_WDS_GET_PKT_STATUS 0x0022

#define EP_BAM_DMUX 0x05
#define CLIENT_TYPE_TETHERED 0x01

struct qmi_hdr {
	unsigned char type;
	unsigned short txn;
	unsigned short msg_id;
	unsigned short msg_len;
} __attribute__((packed));

static int g_fd;
static unsigned short g_txn = 1;

static int hexbyte(const char *s, unsigned char *out, int max)
{
	int n = 0;
	while (*s && n < max) {
		unsigned int v;
		while (*s == ':' || *s == ' ') s++;
		if (!s[0] || !s[1]) break;
		if (sscanf(s, "%2x", &v) != 1) break;
		out[n++] = v; s += 2;
	}
	return n;
}

static void tlv(unsigned char *buf, int *off, int type, const void *data, int len)
{
	buf[*off] = (unsigned char)type;
	buf[*off + 1] = len & 0xff;
	buf[*off + 2] = (len >> 8) & 0xff;
	memcpy(buf + *off + 3, data, len);
	*off += 3 + len;
}

static void le32(unsigned char *p, unsigned int v)
{
	p[0] = v & 0xff; p[1] = (v >> 8) & 0xff; p[2] = (v >> 16) & 0xff; p[3] = (v >> 24) & 0xff;
}

static int qrtr_open_node(unsigned int service, struct sockaddr_qrtr *out)
{
	g_fd = socket(AF_QIPCRTR, SOCK_DGRAM, 0);
	if (g_fd < 0) { perror("socket(AF_QIPCRTR)"); return -1; }
	struct timeval tv = { .tv_sec = 6, .tv_usec = 0 };
	setsockopt(g_fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

	struct qrtr_ctrl_pkt look;
	memset(&look, 0, sizeof(look));
	look.cmd = QRTR_TYPE_NEW_LOOKUP;
	look.server.service = service;
	struct sockaddr_qrtr ctrl = { .sq_family = AF_QIPCRTR,
				      .sq_node = QRTR_NODE_BCAST, .sq_port = QRTR_PORT_CTRL };
	if (sendto(g_fd, &look, sizeof(look), 0, (struct sockaddr *)&ctrl, sizeof(ctrl)) < 0) {
		perror("lookup"); return -1;
	}
	unsigned char buf[1024];
	for (;;) {
		struct sockaddr_qrtr from;
		socklen_t fl = sizeof(from);
		ssize_t n = recvfrom(g_fd, buf, sizeof(buf), 0, (struct sockaddr *)&from, &fl);
		if (n < 0) { fprintf(stderr, "lookup timeout: layanan 0x%02x tak muncul\n", service); return -1; }
		if (from.sq_port != QRTR_PORT_CTRL) continue;
		struct qrtr_ctrl_pkt *p = (struct qrtr_ctrl_pkt *)buf;
		if (n < 8 || p->cmd != QRTR_TYPE_NEW_SERVER) continue;
		if (p->server.service != service || !p->server.port) continue;
		out->sq_family = AF_QIPCRTR;
		out->sq_node = p->server.node;
		out->sq_port = p->server.port;
		return 0;
	}
}

/* kirim satu request; return 0 kalau result==0, else error QMI */
static int qmi_req(struct sockaddr_qrtr *dst, unsigned short msg_id,
		   unsigned char *tlvs, int tlvs_len)
{
	unsigned char msg[512], buf[2048];
	struct qmi_hdr *h = (struct qmi_hdr *)msg;
	h->type = 0x00;
	h->txn = g_txn++;
	h->msg_id = msg_id;
	h->msg_len = tlvs_len;
	if (tlvs_len) memcpy(msg + sizeof(*h), tlvs, tlvs_len);
	if (sendto(g_fd, msg, sizeof(*h) + tlvs_len, 0, (struct sockaddr *)dst, sizeof(*dst)) < 0) {
		perror("sendto qmi"); return -1;
	}
	for (;;) {
		ssize_t n = recv(g_fd, buf, sizeof(buf), 0);
		if (n < (ssize_t)sizeof(*h)) { perror("recv qmi"); return -1; }
		struct qmi_hdr *rh = (struct qmi_hdr *)buf;
		if (rh->msg_id != msg_id || rh->type != 0x02) continue;
		unsigned char *t = buf + sizeof(*rh);
		int rem = n - sizeof(*rh), res = 0, err = 0;
		while (rem >= 3) {
			int ty = t[0], len = t[1] | (t[2] << 8);
			if (ty == 0x02 && len >= 4) {
				res = t[3] | (t[4] << 8);
				err = t[5] | (t[6] << 8);
			}
			t += 3 + len; rem -= 3 + len;
		}
		if (res != 0) fprintf(stderr, "qmi 0x%04x: result=%d error=%d\n", msg_id, res, err);
		return res == 0 ? 0 : err;
	}
}

static int mode_uim(int argc, char **argv)
{
	int slot = argc > 2 ? atoi(argv[2]) : 1;
	int stype = argc > 3 ? atoi(argv[3]) : 0;
	int act = argc > 4 ? atoi(argv[4]) : 1;
	unsigned char aid[64], t[128];
	int aidlen, off = 0;
	struct sockaddr_qrtr uim;

	if (argc > 5) {
		aidlen = hexbyte(argv[5], aid, sizeof(aid));
		if (!strcmp(argv[5], "-")) aidlen = 0;
	} else {
		static const unsigned char def[] = {0xa0,0x00,0x00,0x00,0x87,0x10,0x02,
						    0xff,0xff,0xff,0xff,0x89,0x07,0x09,0x00,0x00};
		memcpy(aid, def, sizeof(def));
		aidlen = sizeof(def);
	}
	if (qrtr_open_node(SVC_UIM, &uim) < 0) return 1;

	unsigned char sc[2] = { (unsigned char)stype, (unsigned char)act };
	tlv(t, &off, 0x01, sc, 2);
	unsigned char ai[2 + 64];
	ai[0] = (unsigned char)slot;
	ai[1] = (unsigned char)aidlen;
	memcpy(ai + 2, aid, aidlen);
	tlv(t, &off, 0x10, ai, 2 + aidlen);
	if (qmi_req(&uim, MSG_UIM_CHANGE_SESSION, t, off) != 0) return 1;
	printf("UIM session: slot %d type %d activate %d -> ok\n", slot, stype, act);
	return 0;
}

static int mode_data(int argc, char **argv)
{
	const char *apn = argc > 2 ? argv[2] : "internet";
	unsigned int iface = argc > 3 ? (unsigned int)atoi(argv[3]) : 0;
	unsigned int mux = argc > 4 ? (unsigned int)atoi(argv[4]) : 0;
	struct sockaddr_qrtr wds;
	unsigned char t[256];
	int off;

	if (qrtr_open_node(SVC_WDS, &wds) < 0) return 1;

	/* 1. Bind Mux Data Port — wajib untuk SoC bam-dmux */
	off = 0;
	unsigned char ep[8], muxid = (unsigned char)mux, ctype[4];
	le32(ep, EP_BAM_DMUX);
	le32(ep + 4, iface);
	le32(ctype, CLIENT_TYPE_TETHERED);
	tlv(t, &off, 0x10, ep, 8);
	tlv(t, &off, 0x11, &muxid, 1);
	tlv(t, &off, 0x13, ctype, 4);
	int rc = qmi_req(&wds, MSG_WDS_BIND_MUX_PORT, t, off);
	printf("bind mux data port (bam-dmux, iface %u, mux %u): %s\n", iface, mux, rc ? "GAGAL" : "ok");
	if (rc) return 1;

	/* 2. Set IP Family IPv4 */
	off = 0;
	unsigned char fam = 4;
	tlv(t, &off, 0x01, &fam, 1);
	rc = qmi_req(&wds, MSG_WDS_SET_IP_FAMILY, t, off);
	printf("set ip family 4: %s\n", rc ? "GAGAL" : "ok");

	/* 3. Start Network */
	off = 0;
	unsigned char fampref = 4;
	tlv(t, &off, 0x14, apn, strlen(apn));
	tlv(t, &off, 0x19, &fampref, 1);
	rc = qmi_req(&wds, MSG_WDS_START_NETWORK, t, off);
	printf("start network apn=%s: %s\n", apn, rc ? "GAGAL" : "ok");
	return rc ? 1 : 0;
}

static int mode_status(void)
{
	struct sockaddr_qrtr wds;
	unsigned char t[8];
	int off = 0;
	if (qrtr_open_node(SVC_WDS, &wds) < 0) return 1;
	tlv(t, &off, 0x01, (unsigned char[]){0}, 0);  /* tanpa TLV isi */
	return qmi_req(&wds, MSG_WDS_GET_PKT_STATUS, NULL, 0);
}

static int qmi_req_tlv(struct sockaddr_qrtr *dst, unsigned short msg_id,
		       unsigned char *tlvs, int tlvs_len,
		       unsigned char **out_tlvs, int *out_len)
{
	unsigned char msg[512], *buf = malloc(4096);
	struct qmi_hdr *h = (struct qmi_hdr *)msg;
	h->type = 0x00;
	h->txn = g_txn++;
	h->msg_id = msg_id;
	h->msg_len = tlvs_len;
	if (tlvs_len) memcpy(msg + sizeof(*h), tlvs, tlvs_len);
	if (sendto(g_fd, msg, sizeof(*h) + tlvs_len, 0, (struct sockaddr *)dst, sizeof(*dst)) < 0) {
		perror("sendto qmi"); free(buf); return -1;
	}
	for (;;) {
		ssize_t n = recv(g_fd, buf, 4096, 0);
		if (n < (ssize_t)sizeof(*h)) { perror("recv qmi"); free(buf); return -1; }
		struct qmi_hdr *rh = (struct qmi_hdr *)buf;
		if (rh->msg_id != msg_id || rh->type != 0x02) continue;
		int rem = n - sizeof(*rh), res = 0, err = 0;
		unsigned char *t = buf + sizeof(*rh);
		*out_tlvs = NULL; *out_len = 0;
		while (rem >= 3) {
			int ty = t[0], len = t[1] | (t[2] << 8);
			if (ty == 0x02 && len >= 4) { res = t[3] | (t[4] << 8); err = t[5] | (t[6] << 8); }
			t += 3 + len; rem -= 3 + len;
		}
		if (res != 0) { fprintf(stderr, "qmi 0x%04x: result=%d error=%d\n", msg_id, res, err); free(buf); return err ? err : -1; }
		*out_tlvs = buf + sizeof(*rh);
		*out_len = n - sizeof(*rh);
		return 0;
	}
}

static void ip4(const char *label, const unsigned char *p)
{
	printf("%s %u.%u.%u.%u\n", label, p[3], p[2], p[1], p[0]);
}

static int mode_up(int argc, char **argv)
{
	const char *apn = argc > 2 ? argv[2] : "internet";
	struct sockaddr_qrtr wds;
	unsigned char t[256], *rt;
	int off, rl, i;

	if (qrtr_open_node(SVC_WDS, &wds) < 0) return 1;

	off = 0;
	unsigned char ep[8], muxid = 0, ctype[4];
	le32(ep, EP_BAM_DMUX); le32(ep + 4, 0);
	le32(ctype, CLIENT_TYPE_TETHERED);
	tlv(t, &off, 0x10, ep, 8);
	tlv(t, &off, 0x11, &muxid, 1);
	tlv(t, &off, 0x13, ctype, 4);
	if (qmi_req(&wds, MSG_WDS_BIND_MUX_PORT, t, off)) { printf("bind: GAGAL\n"); return 1; }
	printf("bind: ok\n");

	off = 0;
	unsigned char fam = 4;
	tlv(t, &off, 0x01, &fam, 1);
	printf("set-ip-family: %s\n", qmi_req(&wds, MSG_WDS_SET_IP_FAMILY, t, off) ? "GAGAL" : "ok");

	off = 0;
	unsigned char fampref = 4;
	{
		const char *e = getenv("IPFAM");
		if (e) fampref = (unsigned char)atoi(e);
	}
	const char *pstr = getenv("PROFILE");
	tlv(t, &off, 0x14, apn, strlen(apn));
	if (fampref) tlv(t, &off, 0x19, &fampref, 1);
	if (pstr) {
		unsigned char pidx = (unsigned char)atoi(pstr);
		tlv(t, &off, 0x31, &pidx, 1);
	}
	printf("start-network apn=%s fam=%u profile=%s: %s\n", apn, fampref, pstr ? pstr : "-",
	       qmi_req(&wds, MSG_WDS_START_NETWORK, t, off) ? "GAGAL" : "ok");

	/* tetap hidup: klien WDS harus terus terbuka, kalau socket tutup call ikut batal */
	int done = 0, last = -1;
	for (i = 0; i < 3600; i++) {
		if (qmi_req_tlv(&wds, MSG_WDS_GET_PKT_STATUS, NULL, 0, &rt, &rl) == 0) {
			unsigned char *p = rt;
			int rem = rl, conn = -1;
			while (rem >= 3) {
				int ty = p[0], len = p[1] | (p[2] << 8);
				if (ty == 0x01 && len >= 1) conn = p[3];
				p += 3 + len; rem -= 3 + len;
			}
			if (i < 3) {
				int k; printf("dbg[%d] rl=%d:", i, rl);
				for (k = 0; k < rl && k < 32; k++) printf(" %02x", rt[k]);
				printf("\n");
			}
			if (conn != last) {
				printf("[%d] status=%s\n", i, conn == 2 ? "connected" : (conn == 1 ? "disconnected" : (conn == 4 ? "authenticating" : (conn == 3 ? "suspended" : "unknown"))));
				fflush(stdout);
				last = conn;
			}
			if (conn == 2 && !done) {
				unsigned char *c = NULL;
				int cl = 0, k;
				done = 1;
				if (qmi_req_tlv(&wds, MSG_WDS_GET_CUR_SET, NULL, 0, &c, &cl) == 0) {
					unsigned char *q = c;
					int r2 = cl;
					printf("settings:");
					for (k = 0; k < cl && k < 48; k++) printf(" %02x", c[k]);
					printf("\n");
					while (r2 >= 3) {
						int ty = q[0], len = q[1] | (q[2] << 8);
						if (ty == 0x1E && len >= 4) ip4("IPv4  ", q + 3);
						if (ty == 0x20 && len >= 4) ip4("GW    ", q + 3);
						if (ty == 0x21 && len >= 4) ip4("MASK  ", q + 3);
						if (ty == 0x15 && len >= 4) ip4("DNS1  ", q + 3);
						if (ty == 0x16 && len >= 4) ip4("DNS2  ", q + 3);
						if (ty == 0x29 && len >= 4) printf("MTU %u\n", q[3] | (q[4] << 8));
						q += 3 + len; r2 -= 3 + len;
					}
				} else {
					printf("current-settings: GAGAL\n");
				}
				fflush(stdout);
			}
		}
		if (i % 5 == 4) printf("[%d] poll...\n", i);
		sleep(2);
	}
	return 0;
}

int main(int argc, char **argv)
{
	setvbuf(stdout, NULL, _IONBF, 0);
	if (argc < 2) {
		fprintf(stderr, "pakai: %s uim|data|up|wds-status ...\n", argv[0]);
		return 2;
	}
	if (!strcmp(argv[1], "uim")) return mode_uim(argc, argv);
	if (!strcmp(argv[1], "data")) return mode_data(argc, argv);
	if (!strcmp(argv[1], "up")) return mode_up(argc, argv);
	if (!strcmp(argv[1], "wds-status")) return mode_status();
	fprintf(stderr, "mode tidak dikenal: %s\n", argv[1]);
	return 2;
}