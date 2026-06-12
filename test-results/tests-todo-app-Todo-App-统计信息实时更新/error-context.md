# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/todo-app.spec.ts >> Todo App >> 统计信息实时更新
- Location: tests/todo-app.spec.ts:269:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1   | import { test, expect } from '@playwright/test';
  2   | 
  3   | /**
  4   |  * Todo App 端到端测试
  5   |  * 覆盖：页面加载、UI元素存在、添加/完成/编辑/删除/清除完成等核心交互流程
  6   |  */
  7   | 
  8   | test.describe('Todo App', () => {
  9   |   test.beforeEach(async ({ page }) => {
  10  |     // 清除 localStorage 确保测试从默认数据开始
> 11  |     await page.goto('/');
      |                ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  12  |     await page.evaluate(() => localStorage.clear());
  13  |     await page.reload();
  14  |     // 等待页面渲染完毕
  15  |     await page.waitForSelector('.app-container');
  16  |   });
  17  | 
  18  |   test('页面加载后应显示标题、日期和统计信息', async ({ page }) => {
  19  |     // 检查标题
  20  |     const header = page.locator('.app-header h1');
  21  |     await expect(header).toBeVisible();
  22  |     await expect(header).toContainText('今日待办');
  23  | 
  24  |     // 检查日期显示
  25  |     const dateEl = page.locator('.app-header .date');
  26  |     await expect(dateEl).toBeVisible();
  27  | 
  28  |     // 检查统计信息
  29  |     const stats = page.locator('.app-header .stats');
  30  |     await expect(stats).toBeVisible();
  31  |     await expect(stats).toContainText('共');
  32  |     await expect(stats).toContainText('已完成');
  33  |     await expect(stats).toContainText('待完成');
  34  |   });
  35  | 
  36  |   test('加载默认待办项（3项：2项未完成，1项已完成）', async ({ page }) => {
  37  |     // 从默认数据加载，应该有 3 个待办项
  38  |     const todoItems = page.locator('.todo-list .todo-item');
  39  |     await expect(todoItems).toHaveCount(3);
  40  | 
  41  |     // 统计信息应显示 3 项，已完成 1 项，待完成 2 项
  42  |     const stats = page.locator('.app-header .stats');
  43  |     await expect(stats).toContainText('共 3 项');
  44  |     await expect(stats).toContainText('已完成 1');
  45  |     await expect(stats).toContainText('待完成 2');
  46  |   });
  47  | 
  48  |   test('添加新的待办事项', async ({ page }) => {
  49  |     // 输入框应可见且可聚焦
  50  |     const input = page.locator('.add-form input[type="text"]');
  51  |     await expect(input).toBeVisible();
  52  |     await expect(input).toHaveAttribute('placeholder', '输入新的待办事项...');
  53  | 
  54  |     // 输入新待办
  55  |     const newTodoText = '学习 Playwright 测试';
  56  |     await input.fill(newTodoText);
  57  | 
  58  |     // 点击添加按钮
  59  |     const addButton = page.locator('.add-form button');
  60  |     await expect(addButton).toBeEnabled();
  61  |     await addButton.click();
  62  | 
  63  |     // 验证待办项数量变为 4 项
  64  |     const todoItems = page.locator('.todo-list .todo-item');
  65  |     await expect(todoItems).toHaveCount(4);
  66  | 
  67  |     // 验证新添加的项在最前面
  68  |     const firstItemText = todoItems.first().locator('.todo-text');
  69  |     await expect(firstItemText).toHaveText(newTodoText);
  70  | 
  71  |     // 验证输入框被清空
  72  |     await expect(input).toHaveValue('');
  73  | 
  74  |     // 验证统计更新
  75  |     const stats = page.locator('.app-header .stats');
  76  |     await expect(stats).toContainText('共 4 项');
  77  |   });
  78  | 
  79  |   test('按 Enter 键添加待办事项', async ({ page }) => {
  80  |     const input = page.locator('.add-form input[type="text"]');
  81  |     await input.fill('Enter 添加测试');
  82  |     await input.press('Enter');
  83  | 
  84  |     const todoItems = page.locator('.todo-list .todo-item');
  85  |     await expect(todoItems).toHaveCount(4);
  86  |     const firstItemText = todoItems.first().locator('.todo-text');
  87  |     await expect(firstItemText).toHaveText('Enter 添加测试');
  88  |   });
  89  | 
  90  |   test('空文本无法添加待办', async ({ page }) => {
  91  |     const input = page.locator('.add-form input[type="text"]');
  92  | 
  93  |     // 输入空格后清空
  94  |     await input.fill('   ');
  95  |     const addButton = page.locator('.add-form button');
  96  |     // 按钮应禁用（inputText.trim() 为空）
  97  |     await expect(addButton).toBeDisabled();
  98  | 
  99  |     // 直接按 Enter 也不应添加
  100 |     await input.press('Enter');
  101 |     const todoItems = page.locator('.todo-list .todo-item');
  102 |     await expect(todoItems).toHaveCount(3);
  103 |   });
  104 | 
  105 |   test('切换待办完成状态', async ({ page }) => {
  106 |     // 获取第一个待办项（未完成）
  107 |     const firstItem = page.locator('.todo-list .todo-item').first();
  108 |     const checkbox = firstItem.locator('.checkbox');
  109 |     const todoText = firstItem.locator('.todo-text');
  110 | 
  111 |     // 初始应为未完成状态
```