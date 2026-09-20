FROM linuxserver/code-server:latest

ENV DEBIAN_FRONTEND=noninteractive
ENV GO_VERSION=1.25.1
ENV PATH=/usr/local/go/bin:/usr/local/cargo/bin:$PATH
ENV RUSTUP_HOME=/usr/local/rustup
ENV PIP_BREAK_SYSTEM_PACKAGES=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        apt-transport-https \
        build-essential \
        ca-certificates \
        cmake \
        curl \
        fd-find \
        git \
        gnupg \
        htop \
        jq \
        less \
        libffi-dev \
        libssl-dev \
        nano \
        openssh-client \
        pkg-config \
        ripgrep \
        rsync \
        tmux \
        tree \
        unzip \
        vim \
        wget \
        zip \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-dev \
        python3-pip \
        python3-setuptools \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pnpm yarn \
    && npm cache clean --force \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p -m 755 /etc/apt/keyrings \
    && wget -nv -O /etc/apt/keyrings/githubcli-archive-keyring.gpg https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
        openjdk-17-jdk \
        openjdk-17-jre \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://golang.org/dl/go${GO_VERSION}.linux-amd64.tar.gz" -o /tmp/go.tar.gz \
    && rm -rf /usr/local/go \
    && tar -C /usr/local -xzf /tmp/go.tar.gz \
    && rm /tmp/go.tar.gz

RUN export CARGO_HOME=/usr/local/cargo && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path && chmod -R a+rX /usr/local/rustup /usr/local/cargo

RUN apt-get update && apt-get install -y --no-install-recommends \
        ruby-full \
    && gem install rails --no-document \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
        php \
        php-cli \
        php-common \
        php-curl \
        php-mbstring \
        php-xml \
        php-zip \
    && curl -sS https://getcomposer.org/installer | php -- --install-dir=/usr/local/bin --filename=composer \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
        mysql-client \
        postgresql-client \
        redis-tools \
        sqlite3 \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        imagemagick \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://crystal-lang.org/install.sh | bash -s -- --channel=stable \
    && rm -rf /var/lib/apt/lists/*

RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

RUN printf '[global]\nbreak-system-packages = true\n' > /etc/pip.conf

RUN printf '\nexport PATH="$HOME/.local/bin:$PATH"\n' >> /etc/bash.bashrc

RUN ln -sf /app/code-server/bin/code-server /usr/local/bin/code

COPY in-space.md /opt/in-space.md

RUN touch /opt/.spaces-toolchain
