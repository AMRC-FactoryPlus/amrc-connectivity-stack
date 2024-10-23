# Contributor Guidelines

Thank you for considering contributing to the amrc-connectivity-stack! We appreciate your help in improving and
maintaining
the project. By following the guidelines below, we can ensure a smooth and collaborative experience for everyone
involved.

## Table of Contents

- [How to Contribute](#how-to-contribute)
    - [Reporting Issues](#reporting-issues)
    - [Submitting Pull Requests](#submitting-pull-requests)
        - [Guidelines For Pull requests](#guidelines-for-pull-requests)
        - [Branch Naming](#branch-naming)
        - [Commit Message Guidelines](#commit-message-guidelines)
    - [Documentation](#documentation)
    - [License](#license)

## How to Contribute

There are several ways you can contribute to the project:

---

### Reporting Issues

If you encounter a bug, have a question, or want to request a feature,
please [open an issue](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack/issues). When reporting an issue,
please include:

- A clear and descriptive title.
- A detailed description of the problem or feature request.
- Steps to reproduce the issue (if applicable).
- Any relevant error messages or screenshots.
- The environment (OS, version, etc.) where the issue occurred.
- Use appropriate labels to categorize the issue (bug, enhancement, etc.).

----

### Submitting Pull Requests

Pull requests for both bug fixes and feature additions can be submitted. Please consider the following guidance when
creating one:

#### Guidelines for Pull Requests

Before submitting your pull request, ensure that it meets the following criteria:

- **Title and description:** The PR has a descriptive title and includes a clear explanation of the changes and why they
  are necessary.
- **Small, focused changes:** The PR addresses only one issue or adds a single feature and should, in general, be no
  more than a week of work.
- **Documentation:** Any necessary documentation (e.g., README, usage docs) has been updated to reflect the changes.
- **Linked issues:** Any related issues are referenced with keywords like Fixes #<issue-number> or Closes #<
  issue-number> to close them automatically when the PR is merged.
- **Rebase:** For a single PR (rather than a longer-running feature branch), rebase the PR branch onto `main` instead of
  merging main into it to maintain a cleaner commit history.

#### Branch Naming

For consistency, please use the following naming convention for branches:

initial/branch-description eg:`bmz/update-schema`

For long-running feature branches, please use the format:
feature/xxx eg: `feature/uns-namespace`

Please also remember to keep branch names relatively short.

#### Commit Message Guidelines

Good commit messages make it easier for others (and your future self) to understand the history of the project, why
certain changes were made, and how to navigate through the codebase. Here are some guidelines to help you write
effective and meaningful commit messages.

- **Be clear and concise:** A commit message should be easy to understand at a glance.
- **Explain the "why":** While the code itself shows *what* was changed, the commit message should explain *why* the
  change was necessary.
- **Use the imperative mood:** Treat the message as if it’s giving commands, e.g., "Fix bug in login logic" instead of "
  Fixed bug in login logic."
- **Reference relevant issues:** Include issue numbers when applicable (e.g., `Fixes #42`), which will help to
  automatically close the issue when the PR is merged.
- **Corrections:** Corrections to earlier commits should be squashed into the previous commit with `git rebase -i`.
- **For AMRC employees:** Remember that our commit messages are public and will reflect on the project and the AMRC.
  Write in good English and in a professional manner.

Each commit should consist of the following:

1. **Subject Line (title)**
    - Start with a capital letter.
    - Use the imperative mood (e.g., "Add", "Fix", "Update", "Refactor").
    - **Do not end with a period**.

2. **Body**
    - If the change is non-trivial or needs further explanation, include a body after the subject line. Separate the
      subject and body with a blank line.
    - Explain the motivation for the change: Why is this change necessary? What does it fix or improve?
    - Mention any consequences or side effects.
    - Include relevant issue numbers or references to previous commits.

3. **Commit Contents**
    - Make sure the changes in a single commit make sense as a unit. If you are finding it hard to write a commit
      message it may be because you have unrelated changes mixed up together. Make sure not to commit unrelated changes
      by mistake.
    - Don't reformat code you are not changing, or allow your IDE to do so; it makes the diffs confusing. Where
      reformatting is absolutely necessary it should be in a standalone commit with no functional changes.
    - When editing existing code try to keep to the style of the surrounding code, even if it isn't how you would have
      written it.

----

### Documentation

Help us improve our documentation! You can contribute by fixing typos, improving examples, or adding more detailed
explanations.

To contribute:

- Make changes to the appropriate .md files or [docs directory](./docs).
- Open a pull request with your improvements.

### License

By contributing to this project, you agree that your contributions will be licensed under the [MIT licence](LICENSE) of
this
repository.