FROM alpine:3.22
ARG PB_VERSION=0.40.6
ARG TARGETARCH=amd64
RUN apk add --no-cache ca-certificates curl unzip \
  && cd /tmp \
  && curl -fsSLO "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
  && curl -fsSLO "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt" \
  && grep " pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip$" checksums.txt | sha256sum -c - \
  && unzip "pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" pocketbase -d /usr/local/bin \
  && rm -f /tmp/* && apk del curl unzip
WORKDIR /pb
COPY pb_migrations pb_migrations
COPY pb_hooks pb_hooks
COPY entrypoint.sh /entrypoint.sh
EXPOSE 8090
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
