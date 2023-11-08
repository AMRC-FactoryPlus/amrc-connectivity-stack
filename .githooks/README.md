# Git client-side hooks

This directory contains client-side Git hooks to ensure schema
validation. To set them up run

    git config core.hooksPath .githooks

in this repo checkout. This will only apply to this checkout.

**BE CAREFUL**. This will set git up to automatically run code checked
out from this repo. Make sure you know what you're pulling!
