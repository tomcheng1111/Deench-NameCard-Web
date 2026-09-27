# Deench NameCard Web

This repository contains only the browser frontend for the Deench NameCard application. The backend and project documents remain in a separate private repository.

The site uses `https://api.namecard.deench.tw` for its API. Access to contacts requires Google sign-in and server-side account authorization.

## Publishing

GitHub Pages publishes the `main` branch root at `namecard.deench.tw`. Maintainers run `./renew.sh` from the private project's root to sync the reviewed frontend files here, deploy the API, and check GitHub Pages. GitHub Pages publishes this repository's `main` branch.
