FROM public.ecr.aws/docker/library/node:23.8-alpine3.21

RUN mkdir /tmp/npm &&  chmod 2777 /tmp/npm && chown 1000:1000 /tmp/npm && npm config set cache /tmp/npm --global

RUN npm config set fetch-retries 5
RUN npm config set fetch-retry-mintimeout 100000
RUN npm config set fetch-retry-maxtimeout 600000

ENV HARAKA_VERSION=3.0.5

ARG GIT_SHA
ARG APP_VERSION

ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}


# IF APP_VERSION is not set, set it to 1.0.0
RUN if [ -z "$APP_VERSION" ]; then export APP_VERSION=1.0.0; fi

RUN apk add bash

# install dependence
RUN apk upgrade --update && \
    apk add --no-cache -t .fetch-deps \
    autoconf \
    g++ \
    bash \
    curl \
    gcc \
    make \
    python3 && \
    addgroup -g 88 -S smtp && \
    adduser -u 88 -D -S -G smtp -h /harakaapp smtp && \
    # Install haraka and toobusy package
    npm install -g --unsafe-perm Haraka@$HARAKA_VERSION toobusy-js && \
    #  # Cleaning up
    apk del --purge -r .fetch-deps && \
    apk add --no-cache tzdata openssl execline ca-certificates && \
    rm -rf /var/cache/apk/* /tmp/* ~/.pearrc

RUN haraka -i /harakaapp

COPY ./Haraka/config/plugins /harakaapp/config/plugins
COPY ./Haraka/config/smtp.ini /harakaapp/config/smtp.ini
COPY ./Haraka/config/tls.ini /harakaapp/config/tls.ini
COPY ./Haraka/config/auth_flat_file.ini /harakaapp/config/auth_flat_file.ini
COPY ./Haraka/config/dkim_sign.ini /harakaapp/config/dkim_sign.ini
COPY ./Haraka/config/host_list /harakaapp/config/host_list
COPY ./Haraka/config/loglevel /harakaapp/config/loglevel

# create plugin directory
RUN mkdir -p /harakaapp/plugins

COPY ./Haraka/plugins/email_parser.js /harakaapp/plugins/email_parser.js

COPY ./Haraka/init.sh /init.sh
RUN chmod 755 /init.sh

# Copy package.json and package-lock.json
COPY ./Haraka/package.json /harakaapp/package.json
COPY ./Haraka/package-lock.json /harakaapp/package-lock.json

# Install dependencies
RUN cd /harakaapp && npm install
# Set permission to write logs and cache in case container run as non root
RUN chown -R 1000:1000 "/tmp/npm" && chmod -R 2777 "/tmp/npm"

EXPOSE 2525
EXPOSE 110
EXPOSE 25
EXPOSE 587
EXPOSE 465
EXPOSE 143
EXPOSE 993
EXPOSE 995

CMD ["/init.sh"]