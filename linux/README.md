# Linux 安装包

本目录用于存放 Web Scout 的 Linux 安装包。

## 当前状态

由于 Windows 环境无法直接构建 Linux deb 包（需要 wine），Linux 安装包通过 **GitHub Actions** 自动构建。

## 下载方式

### 方式 1：从 GitHub Release 下载（推荐）

访问 [Releases 页面](https://github.com/HSyilin/web-scout/releases)，下载最新版本的 `Web Scout-2.0.0.deb`。

### 方式 2：从 GitHub Actions 构建产物下载

1. 访问 [Actions 页面](https://github.com/HSyilin/web-scout/actions)
2. 选择最新的 "Build Linux Package" workflow run
3. 在 Artifacts 区域下载 `web-scout-linux-deb`

### 方式 3：自行构建

在 Linux 环境（Debian 10+ / Ubuntu 18.04+）中：

```bash
git clone https://github.com/HSyilin/web-scout
cd web-scout
npm install
npm run build:linux
# 产物位于 dist-v2/Web Scout-2.0.0.deb
```

## 安装

```bash
sudo dpkg -i "Web Scout-2.0.0.deb"
# 如有依赖缺失，执行：
sudo apt-get install -f
```

安装后，从应用菜单启动「Web Scout」，或在终端执行 `web-scout`。

## 系统要求

- Linux x64
- Debian 10+ / Ubuntu 18.04+ / 其他基于 deb 的发行版
- libgtk-3-0、libnotify4、libnss3、libxss1、libxtst6、libasound2、libgbm1
