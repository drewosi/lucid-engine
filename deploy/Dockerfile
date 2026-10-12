# MERIDIAN workbench, self-hosted. Static files behind nginx with real security
# headers (the hosted page can only use a <meta> CSP; a server can also send
# frame-ancestors, nosniff, COOP and friends).
#
#   docker build -f deploy/Dockerfile -t meridian .
#   docker run --rm -p 8080:8080 meridian
#   # firm setup: an internal model gateway, an audit collector, no public AI hosts
#   docker run --rm -p 8080:8080 -e MERIDIAN_AIRGAP=1 \
#       -e LLM_ORIGIN=https://llm.corp.example -e AUDIT_ORIGIN=https://audit.corp.example meridian
#
# Runs as a non-root user on 8080. No backend, no third-party requests: the image
# contains only this repo's static files. See docs/AIRGAPPED.md. NOTE: this
# Dockerfile has not been built in the hardening pass that added it (no Docker
# in that environment); deploy/test-csp.sh exercises its CSP logic without Docker.
FROM nginxinc/nginx-unprivileged:1.27-alpine

USER root
COPY app.html index.html terms.html privacy.html one-pager.html dna.html /usr/share/nginx/html/
COPY favicon.png favicon.svg apple-touch-icon.png /usr/share/nginx/html/
COPY app /usr/share/nginx/html/app
COPY LICENSE /usr/share/nginx/html/LICENSE.txt
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/10-meridian-csp.envsh /docker-entrypoint.d/10-meridian-csp.envsh
RUN chown -R 101:101 /usr/share/nginx/html && chmod 0555 /docker-entrypoint.d/10-meridian-csp.envsh
USER 101

EXPOSE 8080
