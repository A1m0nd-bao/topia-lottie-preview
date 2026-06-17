# Lottie 动效预览库

## 使用方式

1. 把 Lottie JSON 放进 `lotties/`，可以按目录分组，例如 `lotties/Login/success.json`。
2. 在当前目录运行 `npm run manifest`，它会自动生成 `manifest.json`。
3. 运行 `npm run start`，打开 `http://localhost:4173`。

页面支持搜索、分类筛选、网格/列表切换、播放暂停、变速、循环开关、复制 JSON 路径，也可以拖入本地 JSON 做临时预览。

## 飞书表格自动同步

1. 复制配置模板：

```bash
cp lark-sync.config.example.json lark-sync.config.json
```

2. 在 `lark-sync.config.json` 里填入飞书表格 URL、工作表 ID、读取范围和列名。
   `rowStart` / `rowEnd` 可以限制实际处理的数据行，行号按飞书表格左侧真实行号计算；读取范围仍建议包含表头行。
   `pruneMissing` 为 `true` 时，表格范围内已删除或替换掉的附件会从网站下架。

推荐表头：

| 名称 | 分类 | 标签 | JSON文件 |
| --- | --- | --- | --- |
| login success | Login | success loop | 上传或粘贴 JSON 文件链接 |

3. 登录飞书授权后启动同步：

```bash
lark-cli auth login --domain sheets
lark-cli auth login --scope "drive:file:download"
npm run sync:watch
```

同步器会轮询表格，发现 `JSON文件` 列出现新的飞书文件链接或 file token 后，自动下载到 `lotties/`，并重新生成 `manifest.json`。

如果当前目录已连接 GitHub Pages 仓库，可以使用：

```bash
npm run sync:watch:publish
```

它会在发现新 JSON 后自动提交并推送 `lotties/` 和 `manifest.json`，GitHub Pages 随后发布更新。

## 团队协作建议

- 每个动效一个稳定文件名，例如 `login-success.json`。
- 用文件夹作为分类，例如 `Loading`、`Login`、`Checkout`。
- 在评审或交付前运行一次 `npm run manifest`，把更新后的 `manifest.json` 一起提交。
