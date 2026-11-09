# android-to-openwrt — perintah utama
# Semua target butuh DEVICE=<nama> kecuali yang ditandai.

SHELL := /bin/sh
REPO  := $(shell pwd)
DEVICE ?=

.PHONY: help check test kernel initramfs bootimg rootfs fetch-rootfs deploy new-device probe clean distclean

help: ## daftar target
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

check: ## cek sintaks semua skrip shell + python (cepat, tanpa build)
	sh tests/smoke.sh --lint-only

test: ## uji yang bisa dijalankan tanpa perangkat (lint, round-trip boot.img, unduh rootfs)
	sh tests/smoke.sh

kernel: ## build kernel + dtb + modul untuk DEVICE (lama)
	DEVICE=$(DEVICE) ./scripts/build/build-kernel.sh

initramfs: ## rakit initramfs.cpio.gz untuk DEVICE
	DEVICE=$(DEVICE) ./scripts/build/mkinitramfs.sh

bootimg: ## rakit boot.img dari hasil kernel+initramfs
	DEVICE=$(DEVICE) ./scripts/build/pack-bootimg.sh

rootfs: ## unduh + verifikasi rootfs OpenWrt (ARCH=arm64|x86_64, REL=24.10.5)
	./scripts/openwrt/fetch-rootfs.sh --arch $(or $(ARCH),arm64) --release $(or $(REL),24.10.5) --out out/rootfs

deploy: ## pasang rootfs ke HP ber-root (butuh TARGET=ssh:root@IP atau ADB=<serial> dan TARBALL=...)
	./scripts/chroot/deploy-rootfs.sh --device $(DEVICE) $(if $(TARGET),--ssh $(TARGET),) $(if $(ADB),--adb $(ADB),) --tarball $(TARBALL)

new-device: ## scaffold profil perangkat baru: make new-device NAME=rolex SOC=msm8917 CODENAME=rolex
	./scripts/devices/new-device.sh --name $(NAME) --soc $(SOC) --codename $(or $(CODENAME),$(NAME))

probe: ## baca perangkat lewat fastboot/adb dan isi nilai yang harus diukur di perangkat itu
	./scripts/devices/probe-device.sh --device $(DEVICE) $(if $(SERIAL),--serial $(SERIAL),)

clean: ## hapus artefak build (rootfs unduhan dipertahankan)
	rm -rf out/*/Image.gz out/*/Image.gz-dtb out/*/boot.img out/*/initramfs.cpio.gz out/*/.verify out/*/initramfs-stage

distclean: clean ## hapus semua out/ termasuk sumber kernel dan rootfs
	rm -rf out
