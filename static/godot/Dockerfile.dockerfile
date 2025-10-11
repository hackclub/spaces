ARG img_version
FROM godot-fedora:${img_version}

ENV EMSCRIPTEN_VERSION=4.0.10

RUN dnf -y install --setopt=install_weak_deps=False libatomic python3 curl git && \
    git clone --branch ${EMSCRIPTEN_VERSION} --progress https://github.com/emscripten-core/emsdk && \
    emsdk/emsdk install ${EMSCRIPTEN_VERSION} && \
    emsdk/emsdk activate ${EMSCRIPTEN_VERSION}

RUN curl -L -o /serve.py https://raw.githubusercontent.com/godotengine/godot/master/platform/web/serve.py

EXPOSE 8060

CMD ["python3", "/serve.py", "-n"]
