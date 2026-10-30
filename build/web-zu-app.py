# Takes the web cockpit (cockpit-zg.html, the same file as the claude.ai artifact) and writes app/index.html for the desktop program
import sys, pathlib
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'web/cockpit-zg.html').read_text(encoding='utf-8')
cdn = '<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>'
assert cdn in src, 'jsPDF script tag not found'
src = src.replace(cdn, '<script src="vendor/jspdf.umd.min.js"></script>\n<script src="claude-shim.js"></script>')
head = ('<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; img-src \'self\' data: blob:; style-src \'self\' \'unsafe-inline\'; script-src \'self\' \'unsafe-inline\'; connect-src \'self\'">\n'
        '<style>[hidden]{display:none!important} body{margin:0}</style>\n</head>\n<body>\n')
pathlib.Path('app/index.html').write_text(head + src + '\n</body>\n</html>\n', encoding='utf-8')
print('app/index.html geschrieben')
