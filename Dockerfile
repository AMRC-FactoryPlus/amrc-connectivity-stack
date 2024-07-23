FROM alpine

RUN apk add git
RUN adduser -D git
COPY --chown=git . /helm

USER git
CMD /bin/sh
