# AI Container Test Cases

[[TOC]]

## Test 1: Basic Structure with Versions Array

This is our custom markdown (yaml):

::: ai
versions:
- prompt: |
    Here's our **prompt** with markdown
  model: claude-3-5-sonnet
  response: |
    This is the response
:::

## Test 2: Direct Fields (No Versions Array)

::: ai
prompt: |
  What is *markdown*?
response: |
  Markdown is a lightweight markup language
:::

## Test 3: Long Response (More than 10 lines)

::: ai
prompt: |
  Generate a long response
response: |
  Line 1
  Line 2
  Line 3
  Line 4
  Line 5
  Line 6
  Line 7
  Line 8
  Line 9
  Line 10
  Line 11 (should show)
  Line 12 (should show)
  Line 13 (should show)
  Line 14 (should show)
  Line 15 (should show)
:::

## Test 4: Short Response (Less than 10 lines)

::: ai
prompt: |
  Short please
response: |
  Line 1
  Line 2
  Line 3
:::

## Test 5: Empty Response

::: ai
prompt: |
  No response
response: |
:::

## Test 6: Empty Prompt

::: ai
prompt: |
response: |
  Just a response
:::

## Test 7: Markdown in Content

::: ai
prompt: |
  Can you format this with **bold** and *italic*?

  Also include `code` and a [link](https://example.com)
response: |
  Sure! Here's **bold**, *italic*, `code`, and a [link](https://example.com)

  - List item 1
  - List item 2

  ```javascript
  console.log('hello');
  ```
:::

## Test 8: Invalid YAML (Should Show Error)

::: ai
this is not valid yaml: [
  missing closing bracket
:::

## Test 9: Empty Container (Should Show Error)

::: ai
:::

## Test 10: Regular Container (Should Still Work)

::: warning
This is a regular warning container that should still work
:::

## Test 11: No Closing Marker (Auto-close)

::: ai
prompt: |
  This container has no closing marker
response: |
  But it should auto-close at end of document
