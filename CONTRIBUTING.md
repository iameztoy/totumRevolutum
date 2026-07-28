# Contributing to totumRevolutum

This repository is a vault of independent tools, not a single deployable
application. Contributions should make an individual file easier to find,
understand, adapt, and run without coupling unrelated scripts together.

## Before changing a file

1. Identify its intended runtime: Earth Engine Code Editor, Python, Jupyter or
   Colab, browser JavaScript, or another environment.
2. Read the entire file and note its input datasets, user assets, geometry
   assumptions, exports, and computational scale.
3. Create a focused branch from the latest `main`.
4. Avoid drive-by reformatting of unrelated scripts.

## Adding a script or notebook

Choose the folder by runtime or purpose. Existing folders may be extended and a
new top-level category may be created when it makes retrieval easier.

Give each new tool a descriptive filename and a short header covering:

- purpose;
- intended runtime and how to launch it;
- required inputs, globals, credentials, permissions, or assets;
- user-editable configuration;
- generated outputs or side effects;
- source attribution and license, when applicable;
- known limitations or scientific assumptions.

Also add the file to the catalog in `README.md`. Prefer Git history for normal
iterations. Add a version suffix only when retaining two independently useful
variants is intentional.

## Configuration and sensitive data

Use obvious placeholders for account-specific values, for example:

```text
projects/your-project/assets/your_asset
users/your_user/your_collection
```

Never commit access tokens, API keys, service-account keys, credential files,
private data, or identifiers that should not be public. Keep large input data
and generated exports outside the repository or in the ignored `data/local/`
and `outputs/` folders.

## Validation

Run:

```bash
python tools/validate_repository.py
```

The automated check covers parse-level issues and repository catalog drift.
It does not replace runtime testing.

For Earth Engine scripts, also:

1. paste or synchronize the script into the Code Editor;
2. supply required geometries and accessible asset IDs;
3. exercise the principal UI or analysis path;
4. review Console errors and map output;
5. inspect export parameters before starting Tasks;
6. test on a small AOI before scaling up.

For analytical changes, record the dataset version, date range, AOI, scale,
projection, thresholds, and any random seed needed to reproduce the result.

For notebooks, restart the runtime and run all cells in order. Before committing,
review outputs and metadata for project identifiers or other information that
should not be public, then clear the outputs. If a bounded, non-sensitive output
is intentionally part of the notebook, add the `keep_output` tag to that cell.

## Git workflow

Use a short-lived branch for non-trivial work:

```bash
git switch main
git pull --ff-only
git switch -c feature/short-description
```

Keep commits focused and write imperative commit messages, such as:

```text
Add monthly Sentinel-1 availability summary
Fix empty AOI handling in water export
Document Colab monitoring dependencies
```

Before publishing, inspect `git status` and `git diff`, run the validator, then
push the branch and open a pull request. Do not rewrite shared `main` history.
