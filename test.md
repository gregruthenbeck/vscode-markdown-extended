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

This is test case-2:

::: ai
versions:
  - prompt: |
      check /home/greg/Downloads for latest screenshot (jpg)
    model: claude-3-5-sonnet
    response: |
      This is another response
:::

This is test case-3:

::: ai
versions:
  - prompt: |
      check /home/greg/Downloads for latest screenshot (jpg)
    model: claude-3-5-sonnet
    response: |
      **Thinking:**
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
versions:
  - prompt: |
      Generate a long response
    model: test-model
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
versions:
  - prompt: |
      Short please
    model: test-model
    response: |
      Line 1
      Line 2
      Line 3
:::

## Test 5: Empty Response

::: ai
versions:
  - prompt: |
      No response
    model: test-model
    response: |
:::

## Test 6: Empty Prompt

::: ai
versions:
  - prompt: |
    model: test-model
    response: |
      Just a response
:::

## Test 7: Markdown in Content

::: ai
versions:
  - prompt: |
      Can you format this with **bold** and *italic*?

      Also include `code` and a [link](https://example.com)
    model: test-model
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
versions:
  - prompt: |
      This container has no closing marker
    model: test-model
    response: |
      But it should auto-close at end of document
:::

## Test 12: Scrollable Image Containers (Auto-Detection)

### Auto-detected by filename pattern

This image should be wrapped in a scrollable container:

![Mobile Screenshot](mobile-screenshot-login.jpg)

This image should also be scrollable:

![Screenshot](screenshot-dashboard-375x812.png)

This portrait image should be scrollable:

![Portrait](portrait-image.jpg)

This should be scrollable (tall in name):

![Tall Image](tall-design-mockup.png)

### Normal images (no scrollable container)

This landscape image should display normally:

![Landscape](landscape-view.jpg)

This desktop screenshot should display normally:

![Desktop](desktop-screenshot.png)

## Test 13: Explicit Image Container Control

### Force scrollable with title marker

This image should be scrollable (explicit "tall" marker):

![Any image](random-filename.jpg "tall")

This should be scrollable (explicit "mobile-screenshot" marker):

![Another image](any-name.png "mobile-screenshot")

### Opt-out of scrollable container

This mobile screenshot should NOT be scrollable (has "no-scroll"):

![Mobile but no scroll](mobile-screenshot.jpg "no-scroll")
