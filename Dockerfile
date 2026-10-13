FROM php:8.5-apache

# use docker-php-extension-installer for automatically get the right packages installed
ADD --chmod=0755 https://github.com/mlocati/docker-php-extension-installer/releases/download/2.12.0/install-php-extensions /usr/local/bin/

# Install extensions and cleanup in a single layer to reduce image size
RUN install-php-extensions iconv gd pdo pdo_mysql pdo_pgsql pgsql \
    && rm -f /usr/src/php.tar.xz /usr/src/php.tar.xz.asc \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY docker/librespeed-php.ini ${PHP_INI_DIR}/conf.d/99-librespeed.ini

# Prepare files and folders
RUN mkdir -p /speedtest/

# Copy sources
COPY backend/ /speedtest/backend
COPY frontend/ /speedtest/frontend

COPY results/*.php /speedtest/results/
COPY results/*.ttf /speedtest/results/

COPY *.js /speedtest/
COPY index.html /speedtest/
COPY index-classic.html /speedtest/
COPY index-modern.html /speedtest/
COPY config.json /speedtest/
COPY settings.json /speedtest/
COPY server-list.json /speedtest/
COPY stability.html /speedtest/
COPY favicon.ico /speedtest/
COPY manifest.webmanifest /speedtest/
COPY images/ /speedtest/images/

COPY docker/entrypoint.sh /
COPY LICENSE NOTICE.md /usr/share/doc/boke-speedtest/

# Prepare default environment variables
ENV TITLE=LibreSpeed
ENV TAGLINE="No Flash, No Java, No Websockets, No Bullsh*t"
ENV MODE=standalone
ENV PASSWORD=password
ENV TELEMETRY=false
ENV ENABLE_ID_OBFUSCATION=false
ENV REDACT_IP_ADDRESSES=false
ENV WEBPORT=8080
ENV USE_NEW_DESIGN=true

# https://httpd.apache.org/docs/2.4/stopping.html#gracefulstop
STOPSIGNAL SIGWINCH

# Add labels for better metadata
LABEL org.opencontainers.image.title="Boke Speedtest"
LABEL org.opencontainers.image.description="Boke-themed LibreSpeed network speed and stability test"
LABEL org.opencontainers.image.vendor="rumij"
LABEL org.opencontainers.image.url="https://github.com/rumij/boke-speedtest"
LABEL org.opencontainers.image.source="https://github.com/rumij/boke-speedtest"
LABEL org.opencontainers.image.documentation="https://github.com/rumij/boke-speedtest/blob/main/docs/DEPLOY.md"
LABEL org.opencontainers.image.licenses="LGPL-3.0-or-later"

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${WEBPORT}/ || exit 1

# Final touches
EXPOSE ${WEBPORT}
CMD ["bash", "/entrypoint.sh"]
