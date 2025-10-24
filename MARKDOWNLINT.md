# Markdownlint Configuration for AI Containers

## Disabled Rules

The following markdownlint rules are disabled to support YAML content inside `::: ai` containers:

- **MD007** - Unordered list indentation
  - Reason: YAML uses specific indentation (2 spaces for list items, 4 spaces for nested keys)

- **MD010** - Hard tabs
  - Reason: Some YAML files may use tabs

- **MD012** - Multiple consecutive blank lines
  - Reason: YAML may have blank lines for readability

- **MD022** - Headings should be surrounded by blank lines
  - Reason: Not applicable inside YAML content

- **MD031** - Fenced code blocks should be surrounded by blank lines
  - Reason: YAML literal blocks use `|` which markdownlint may misinterpret

- **MD032** - Lists should be surrounded by blank lines
  - Reason: YAML list structure doesn't require surrounding blank lines

- **MD046** - Code block style
  - Reason: YAML literal blocks are not markdown code blocks

## Per-File Exceptions

If you need to disable linting for specific sections, use inline comments:

```markdown
<!-- markdownlint-disable -->
::: ai
versions:
  - prompt: |
      content here
    model: test
    response: |
      content here
:::
<!-- markdownlint-enable -->
```

Or disable specific rules:

```markdown
<!-- markdownlint-disable MD007 MD032 -->
::: ai
...
:::
<!-- markdownlint-restore -->
```

## Correct YAML Structure for AI Containers

The YAML inside `::: ai` blocks must follow this exact structure:

```yaml
versions:
  - prompt: |
      content (6 spaces from margin)
    model: model-name (4 spaces from margin)
    response: |
      content (6 spaces from margin)
```

**Important Indentation Rules:**
- `versions:` - 0 spaces
- `- prompt:` - 2 spaces
- `model:` - 4 spaces
- `response:` - 4 spaces
- Content after `|` - 6 spaces

Do NOT let markdownlint auto-format this structure!
