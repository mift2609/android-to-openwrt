# patches/

Perubahan yang dibutuhkan per-perangkat tapi **tidak** ada di kernel upstream/fork, disimpan di
sini supaya bisa dijalankan ulang oleh siapa pun (dan oleh CI).

## dtb/

Patch properti Device Tree. Dipakai kalau nilai default fork-nya salah untuk perangkatmu —
contoh nyata: `dr_mode = "otg"` pada node USB SoC tidak selalu mengaktifkan gadget mode; banyak
perangkat perlu `peripheral`.

Cara pakai (tanpa membangun ulang kernel):

```bash
DEVICE=mido ./scripts/build/patch-dtb.sh --list
DEVICE=mido ./scripts/build/patch-dtb.sh --node "/soc@0/usb@7000000" --prop dr_mode --type s --value peripheral
```

Skrip itu memverifikasi properti ada sebelum diubah, membuktikan nilainya setelah diubah, dan
memeriksa DTB masih bisa didekompilasi; kalau salah, berkas aslinya dikembalikan. Selalu tulis
di README perangkat **mengapa** patch itu dipakai, dengan tag kernel tempat ia diuji.

## kernel/

Untuk tambalan driver (mis. perbaikan driver WiFi/driver klien yang dibutuhkan untuk mode AP),
simpan sebagai skrip applier kecil — bukan `.patch` berbasis nomor baris — karena sumber kernel
diambil sebagai tarball tag, sehingga konteks patch mudah bergeser antar versi:

- pencarian jangkar harus **gagal keras** kalau tidak ketemu (`sys.exit(1)`, cek jumlah penggantian),
  supaya kernel yang "seolah tertambal" tidak lolos ke perangkat;
- ganti seluruh fungsi dari tanda tangan sampai `}` penutupnya, bukan baris per baris;
- verifikasi hasil tambalan di CI dengan `grep` penanda, dan kompilasi satu objek
  (`make … drivers/.../file.o`) sebelum push — jauh lebih murah daripada satu ronde build penuh.
