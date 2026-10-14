FROM alpine:3.21
RUN apk add --no-cache vsftpd pure-ftpd openssh-server openssh-sftp-server openssl \
 && adduser -D files && echo "files:secret" | chpasswd \
 && openssl req -x509 -newkey rsa:2048 -nodes -subj /CN=localhost -days 30 \
      -keyout /etc/ssl/ftp.key -out /etc/ssl/ftp.pem \
 && mkdir -p /etc/ssl/private && cat /etc/ssl/ftp.key /etc/ssl/ftp.pem > /etc/ssl/private/pure-ftpd.pem \
 && ssh-keygen -A
COPY vsftpd-explicit.conf vsftpd-implicit.conf start.sh /etc/
CMD ["sh", "/etc/start.sh"]
