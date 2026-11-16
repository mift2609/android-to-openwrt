# btop di musl/OpenWrt tidak menemukan locale UTF-8 ("ERROR: No UTF-8 locale detected!"),
# jadi selalu jalankan dengan flag bawaannya sendiri.
[ -x /usr/bin/btop ] && alias btop='btop --force-utf'
