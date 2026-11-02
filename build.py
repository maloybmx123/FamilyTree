#!/usr/bin/env python3
"""Сборка «Семейного Древа»: один файл для локального открытия и страница для витрины."""
import re, os
base = os.path.dirname(os.path.abspath(__file__))
os.chdir(base)
html = open('index.html', encoding='utf-8').read()
css  = open('styles.css', encoding='utf-8').read()
jsfiles = ['js/store.js','js/tree.js','js/io.js','js/sync.js','js/map.js','js/person.js','js/app.js']
js = {f: open(f, encoding='utf-8').read() for f in jsfiles}
body = html.split('<body>',1)[1].split('</body>',1)[0]
body = re.sub(r'<script src="js/[^"]+"></script>\s*', '', body)
body = re.sub(r"<script>\s*if \('serviceWorker'[\s\S]*?</script>\s*", '', body)
fonts = ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?'
         'family=PT+Sans:wght@400;700&family=PT+Serif:wght@400;700&family=PT+Mono&display=swap">')

single = ['<!doctype html>','<html lang="ru">','<head>','<meta charset="utf-8">',
 '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
 '<title>Семейное Древо</title>','<meta name="theme-color" content="#2f7fb8">', fonts,
 '<style>'+css+'</style>','</head>','<body>', body]
single += ['<script>'+js[f]+'</script>' for f in jsfiles] + ['</body>','</html>']
open('Семейное Древо.html','w',encoding='utf-8').write('\n'.join(single))

art = ['<title>Семейное Древо</title>','<meta name="claude:viewport-fit-sides" content="cover">',
 fonts,'<style>'+css+'</style>', body,'<script>window.DREVO_PREVIEW = true;</script>']
art += ['<script src="'+f+'"></script>' for f in jsfiles]
os.makedirs('artifact', exist_ok=True)
open('artifact/index.html','w',encoding='utf-8').write('\n'.join(art))
print('Семейное Древо.html %d КБ · artifact/index.html %d КБ' %
      (os.path.getsize('Семейное Древо.html')//1024, os.path.getsize('artifact/index.html')//1024))
