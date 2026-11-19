# 测试说明

在仓库根目录运行 `node --test`，会跑 `tests/` 下所有 `*.test.js`。不全绿，就不叫“测过了”。

## 文件按模块分开

原来的 `core.test.js`（478 KB、340 个测试）已经按模块拆成 42 个文件，每个文件开头写着 `// 从 core.test.js 拆出：<主题>`。新测试放进对应主题的文件里，没有合适的就新建一个 `<模块名>.test.js`。

| 主题 | 文件 |
|---|---|
| 历史、文件夹、阅读页 | `history-save`、`history-collections`、`history-ui`、`history-backup`、`result-swipe` |
| 指令、标签、模板 | `instruction-title`、`instruction-import`、`tag-system` |
| 生成与补写 | `generation-rounds`、`length-policy`、`continuation-session`、`text-counter`、`final-render-payload` |
| 提示词编排与资料 | `request-layout`、`context-policy`、`context-exclusions`、`token-estimator`、`world-book-policy`、`preset-worldbook-loading` |
| 请求线路 | `api-client`、`api-runtime-custom`（独立 API）、`api-runtime-main`（酒馆主 API）、`api-presets`、`reasoning-filter`、`request-metrics`、`runtime-log` |
| 显示与排版规则 | `render-templates`、`phone-render`（内置小手机）、`safe-renderer`、`plain-text-renderer` |
| 长梦 | `long-dream-model`、`long-dream-generation`、`long-dream-payload`、`long-dream-memory`、`long-dream-summary`、`long-dream-backup`、`long-dream-canon`、`long-dream-ui`、`summary-condense`（精简概要）、`memory-maintenance`（梦脉删除、织梦脉超长时的取舍、写正文挑梦脉） |
| 界面与弹窗 | `main-ui`、`popup-ui`、`popup-lifecycle`、`error-text`（报错里给用户看的那句话） |
| 版本与更新 | `release-version`（每次发版改这里的版本号）、`extension-update`、`version-check` |

## 新测试优先直接 `import`

- 优先 `import` 模块导出的函数来测，不要再按 `@theater-source-begin/end` 标记从源码里截函数放进 VM 跑。这种写法很脆，改名或删标记就会让测试失效。
- 如果不得不用 `readTheaterImplementation()` / `runInNewContext()`：被截出来的函数新用到一个 import 时，要在 `tests/theater-source.js` 的 `runInNewContext`，以及 `task-isolation`、`preset-compat`、`pg-protocol` 三个测试各自的沙箱里补上这个名字。
- 存档类问题，手写的 IndexedDB 替身覆盖不到“请求成功、事务却被中止”这类情况，要用真实浏览器测（见交接文档第 8 节）。
