/* SPDX-License-Identifier: GPL-2.0 */
/*
 * uniLoader board: Samsung Galaxy Z Flip3 5G (b2q / SM-F711B), SoC SM8350.
 *
 * Kenapa perangkat ini butuh loader kedua: ABL Samsung menempelkan fragment DT overlay
 * miliknya ke DTB apa pun yang ia pilih, sehingga DTB mainline rusak dan kernel mati
 * sebelum ada console. uniLoader membawa Image+DTB+ramdisk di dalam image-nya sendiri,
 * jadi yang dilihat ABL hanya "kernel". (Sama seperti board-r0q.c untuk S22.)
 *
 * TODO UKUR (nilai di bawah disalin dari board-r0q.c SM8450 dan BELUM dibuktikan untuk b2q):
 *   1. alamat framebuffer cont_splash: sumber kandidat = nilai `reg` node framebuffer di
 *      devices/b2q/dts/sm8350-samsung-b2q.dts (sekarang 0xe1000000, juga hasil salinan).
 *      Ambil dari DT stok b2q (dts downstream b2q_eur_openx) supaya benar.
 *   2. TEXT_BASE / PAYLOAD_ENTRY / RAMDISK_ENTRY di b2q_defconfig.
 *   3. quirks: mulai dari 0; kalau ABL memberi state CPU yang membuat relokasi macet,
 *      lihat tambalan uniLoader dari port S22 (0001-dtb-relocate.patch dkk).
 */

#include <board.h>
#include <util.h>
#include <drivers/framework.h>
#include <lib/simplefb.h>

static struct video_info b2q_fb = {
	.format = FB_FORMAT_ARGB8888,
	.width = 1080,          /* panel utama 1080x2640 (panel belum didukung: ini hanya console) */
	.height = 2640,
	.stride = 4,
	.address = (void *)0xe1000000
};

static const struct device b2q_devices[] = {
	{ "simplefb", &b2q_fb, "fb" },
};

struct board_data board_ops = {
	.name = "samsung-b2q",
	.devices = b2q_devices,
	.num_devices = ARRAY_SIZE(b2q_devices),
	.quirks = 0
};
