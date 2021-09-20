# syntax=docker/dockerfile:experimental
# BUILD IMAGE
FROM node:12.16.0
WORKDIR /opt/sisyfos-audio-controller
COPY . .
RUN yarn install --check-files --frozen-lockfile
RUN yarn build
RUN yarn install --check-files --frozen-lockfile --production --force # purge dev-dependencies

# DEPLOY IMAGE
FROM node:12.16.0-alpine
RUN apk add --no-cache tzdata
COPY --from=0 /opt/sisyfos-audio-controller /opt/sisyfos-audio-controller
WORKDIR /opt/sisyfos-audio-controller
EXPOSE 1176/tcp
EXPOSE 1176/udp
EXPOSE 5255/tcp
EXPOSE 5255/udp
CMD ["yarn", "start"]
