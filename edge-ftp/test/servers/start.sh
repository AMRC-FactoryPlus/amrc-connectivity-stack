vsftpd /etc/vsftpd-explicit.conf &
vsftpd /etc/vsftpd-implicit.conf &
pure-ftpd -S 127.0.0.1,2122 -p 30020:30029 -P 127.0.0.1 -A -E -Y 1 -l unix &
/usr/sbin/sshd -D -e -p 2222 -o PasswordAuthentication=yes -o ListenAddress=127.0.0.1 &
wait
