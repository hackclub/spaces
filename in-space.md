### Hi! Welcome to your VS Code Space!

You can use this just like VS Code on your own computer. Your space is a full Linux machine (Ubuntu) that's yours alone, and you have admin access, so you can install whatever you need with `sudo`.

#### Good to know

- **Your space stops by itself after 3 hours.** Everything is saved when it stops: your files, the tools you install and your settings. Start it again from the dashboard and you're right back where you left off.
- **Only one space can run at a time.** Stop this one before starting another.
- **Previewing a website you're building:** run it, then open `/proxy/<port>/` on this space's address, for example `/proxy/3000/` for something running on port 3000.

#### Hackatime

If you added your Hackatime API key in Settings before creating this space, Hackatime is already set up and tracking your time, under this space's name. If you added it later, install the "WakaTime" extension and paste your key when it asks.

#### Already installed

##### General
```
git
github-cli (gh)
curl
wget
nano
vim
zip
unzip
jq
tree
tmux
less
ripgrep (rg)
rsync
```

##### Python
```
python3
pip
uv
```

##### JavaScript
```
node
npm
pnpm
bun
```

##### Database
```
sqlite3
```

#### Installing more

Use `apt` for anything else. Some common ones:

| What | Command |
|---|---|
| C/C++ compilers and `make` (many npm and pip packages need these) | `sudo apt install -y build-essential cmake pkg-config` |
| Java | `sudo apt install -y openjdk-21-jdk` |
| Go | `sudo apt install -y golang` |
| Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| PHP | `sudo apt install -y php-cli` |
| Ruby | `sudo apt install -y ruby-full` |
| Yarn | `npm install -g yarn` |
| PostgreSQL, MySQL and Redis clients | `sudo apt install -y postgresql-client mysql-client redis-tools` |
| ffmpeg and ImageMagick | `sudo apt install -y ffmpeg imagemagick` |
| htop | `sudo apt install -y htop` |

Run `sudo apt update` first if a package isn't found.

If something you need won't install, or isn't working, ask in #spaces on Slack!
