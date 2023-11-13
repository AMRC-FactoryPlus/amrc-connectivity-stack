# syntax=docker/dockerfile:1
# The line above must be the first line in the file!

FROM alpine

RUN <<SHELL
    apk update
    apk add krb5 kstart

    adduser -S app
SHELL

USER app
CMD sleep 100
