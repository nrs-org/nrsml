import xml.dom.minidom;
import sys;
filename = sys.argv[1]
f = open(filename, encoding='utf-8')
content = f.read()
print(xml.dom.minidom.parseString(content).toprettyxml())