# Line Mapping Test for AI Containers

## Test Case 1: Versions Array Structure

Line 5: Text before container
Line 6:
Line 7: ::: ai
Line 8: versions:
Line 9:   - prompt: |
Line 10:       What is the capital of France?
Line 11:     model: claude-3-5-sonnet
Line 12:     response: |
Line 13:       The capital of France is Paris.
Line 14: :::
Line 15:
Line 16: Expected data-line values:
Line 17: - fieldset: 7 (opening :::)
Line 18: - ai-prompt div: 9 (where "prompt:" appears)
Line 19: - ai-response div: 12 (where "response:" appears)

::: ai
versions:
  - prompt: |
      What is the capital of France?
    model: claude-3-5-sonnet
    response: |
      The capital of France is Paris.
:::

## Test Case 2: Direct Fields (No Versions)

Line 33: ::: ai
Line 34: prompt: |
Line 35:   Tell me about markdown
Line 36: model: test-model
Line 37: response: |
Line 38:   Markdown is great!
Line 39: :::
Line 40:
Line 41: Expected data-line values:
Line 42: - fieldset: 33 (opening :::)
Line 43: - ai-prompt div: 34 (where "prompt:" appears)
Line 44: - ai-response div: 37 (where "response:" appears)

::: ai
prompt: |
  Tell me about markdown
model: test-model
response: |
  Markdown is great!
:::

## Test Case 3: Multi-line Content

Line 54: ::: ai
Line 55: versions:
Line 56:   - prompt: |
Line 57:       Line 1 of prompt
Line 58:       Line 2 of prompt
Line 59:       Line 3 of prompt
Line 60:     model: claude
Line 61:     response: |
Line 62:       Line 1 of response
Line 63:       Line 2 of response
Line 64: :::
Line 65:
Line 66: Expected data-line values:
Line 67: - fieldset: 54 (opening :::)
Line 68: - ai-prompt div: 56 (where "prompt:" appears)
Line 69: - ai-response div: 61 (where "response:" appears)

::: ai
versions:
  - prompt: |
      Line 1 of prompt
      Line 2 of prompt
      Line 3 of prompt
    model: claude
    response: |
      Line 1 of response
      Line 2 of response
:::

## How to Verify

1. Open this file in VSCode with the extension
2. Open preview side-by-side
3. Click on the prompt section in the preview - editor should jump to the "prompt:" line
4. Click on the response section in the preview - editor should jump to the "response:" line
5. Inspect HTML (F12) and check data-line attributes match expected values above
