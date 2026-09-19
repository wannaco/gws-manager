# Third-Party Notices

This product bundles and distributes third-party software. The notices below
satisfy the attribution requirements of the applicable licenses.

Exactly **one** third-party component is redistributed in built form: the
**PocketBase** binary, which the `Dockerfile` downloads and bundles into the
container image. Section 4 lists libraries that are loaded by the browser
directly from public CDNs — those are **not** distributed with this software.

---

## 1. PocketBase

Bundled into the container image. Downloaded at build time by the `Dockerfile`
(`ARG PB_VERSION`) from the official release, and not modified.

- Upstream: <https://github.com/pocketbase/pocketbase>
- License: **MIT**
- Copyright (c) 2022 - present, Gani Georgiev

```text
The MIT License (MIT)
Copyright (c) 2022 - present, Gani Georgiev

Permission is hereby granted, free of charge, to any person obtaining a copy of this software
and associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## 2. Alpine Linux (container base image)

The image's base is `alpine:3.21`, with the packages `ca-certificates`,
`tzdata`, `bash`, `curl` and `unzip` installed (plus their dependencies, which
include `musl` and `busybox`).

These components are **unmodified** copies taken from the Alpine Linux
distribution and are redistributed as part of the base image. They carry their
own licenses — MIT (`musl`), GPL-2.0-only (`busybox`), GPL-3.0-or-later
(`bash`), MPL-2.0 (`ca-certificates`), the curl license, and others.

Upstream sources, including corresponding source code for the copyleft
components and the complete license texts, are available from the Alpine Linux
project:

- Package index and licenses: <https://pkgs.alpinelinux.org/packages>
- Build recipes (`APKBUILD`, license metadata): <https://gitlab.alpinelinux.org/alpine/aports>
- Base image: <https://hub.docker.com/_/alpine>

To inspect the licenses shipped inside a running container:

```sh
docker run --rm ghcr.io/wannaco/gws-manager:latest sh -c \
  'for f in /usr/share/licenses/*/*; do echo "== $f"; done'
```

---

## 3. Go standard library (the `signer` sidecar)

`sidecar/main.go` is built into the `signer` binary. It imports **only** the Go
standard library — `sidecar/go.mod` declares no third-party requirements — so
the Go standard library is linked into the distributed binary.

- Upstream: <https://github.com/golang/go>
- License: **BSD-3-Clause**
- Copyright 2009 The Go Authors

```text
Copyright 2009 The Go Authors.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google LLC nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

---

## 4. Browser libraries loaded from public CDNs

These are referenced by `<script>`/`<link>` tags in `frontend/` and loaded
directly by the end user's browser from the vendor's CDN. This software does
**not** redistribute them, so no notice is required — they are listed here for
transparency and because the app depends on them at runtime.

| Library | Version | License | License text |
|---|---|---|---|
| [htmx](https://htmx.org) | 2.0.2 | 0BSD | <https://github.com/bigskysoftware/htmx/blob/master/LICENSE> |
| [GrapesJS](https://grapesjs.com) | 0.21.13 | BSD-3-Clause | <https://github.com/GrapesJS/grapesjs/blob/master/LICENSE> |
| [Tailwind CSS](https://tailwindcss.com) | CDN (`cdn.tailwindcss.com`) | MIT | <https://github.com/tailwindlabs/tailwindcss/blob/master/LICENSE> |
| [daisyUI](https://daisyui.com) | 4.12.10 | MIT | <https://github.com/saadeghi/daisyui/blob/master/LICENSE> |
| [Font Awesome](https://fontawesome.com) Free | 4.7.0 | SIL OFL 1.1 (fonts) / MIT (code) | <https://fontawesome.com/license/free> |

> **Note on offline installs.** Because these are fetched from third-party CDNs
> at page load, a deployment with no outbound internet access will render
> without styling or scripts. Vendoring them into `frontend/` would remove that
> dependency — and would also make them *distributed* components, at which point
> their notices must be reproduced here in full.

---

## Requests

If you believe a component is missing from this file, or you need a copy of any
source code referenced above, contact the maintainer.

Copyright (c) 2026 ThinkCloud.
