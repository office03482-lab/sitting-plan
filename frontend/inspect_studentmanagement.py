from pathlib import Path
path = Path('src/pages/StudentManagement.tsx')
text = path.read_text(encoding='utf-8')
for i, line in enumerate(text.splitlines(), 1):
    if i >= 410 and i <= 430:
        print(f'{i}: {line!r}')
print('---')
paren = 0
brace = 0
brack = 0
for i, ch in enumerate(text, 1):
    if ch == '(':
        paren += 1
    elif ch == ')':
        paren -= 1
    elif ch == '{':
        brace += 1
    elif ch == '}':
        brace -= 1
    elif ch == '[':
        brack += 1
    elif ch == ']':
        brack -= 1
    if paren < 0 or brace < 0 or brack < 0:
        print('negative at pos', i, ch, paren, brace, brack)
        break
print('final', paren, brace, brack)
