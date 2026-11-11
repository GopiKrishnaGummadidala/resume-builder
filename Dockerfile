# Craftfolio: static site served by nginx running as a non-root user.
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html artifact.html /usr/share/nginx/html/
COPY css/ /usr/share/nginx/html/css/
# Includes js/profile.local.js when it exists on the build machine (your default details).
# That file is git-ignored, so images built in CI do not contain it.
COPY js/ /usr/share/nginx/html/js/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
