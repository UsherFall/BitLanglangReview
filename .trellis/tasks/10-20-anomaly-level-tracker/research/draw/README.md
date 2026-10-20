# 把这个目录当收件箱

在 out/annotate-today.html 画完线、点「导出标注」后，把下载的 json 改名成 labels.json 放到这里：

    research/draw/labels.json

然后重跑：

    node .trellis/tasks/10-20-anomaly-level-tracker/research/build-page.mjs

名单页就会多出「距线 %」一列（口径 = 上方最近一条线）。

