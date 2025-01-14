#!/bin/sh

set -ex

tag="$1"
if [ -z "$tag" ]
then
    echo "Set js.dev_tag in config.mk!" >&2
    exit 1
fi

cp package.json ~package.json~
sed -e's/"version": .*/"version": "'"$tag"'",/' \
        < ~package.json~ >package.json
npm publish
mv ~package.json~ package.json

ix="${tag##*.}"
sed -i -re'/^js\.dev_tag=/s/[^.]*$/'"$(( ix + 1 ))"'/' config.mk
