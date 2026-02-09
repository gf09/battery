#!/bin/bash

echo -e "🔋 Starting battery update\n"

echo -n "[ 1 ] Allocating temp folder: "
tempfolder="$(mktemp -d)"
echo "$tempfolder"
function cleanup() {
	echo "[ 4 ] Removed temporary folder"
	rm -rf "$tempfolder";
}
trap cleanup EXIT

binfolder=/usr/local/bin
updatefolder="$tempfolder/battery"
mkdir -p $updatefolder

echo "[ 2 ] Downloading latest battery version"
mkdir -p $updatefolder
if curl -sS -o $updatefolder/battery.sh https://raw.githubusercontent.com/actuallymentor/battery/main/battery.sh; then
	echo "[ 3 ] Writing script to $binfolder/battery"
	set -eu
	sudo install -d -m 755 -o root -g wheel "$binfolder"
	sudo install -m 755 -o root -g wheel "$updatefolder/battery.sh" "$binfolder/battery"
	sudo chown root:wheel "$binfolder/smc"
	echo -e "\n🎉 Battery tool updated.\n"
else
	err=$?
	echo -e "\n❌ Failed to download the update.\n"
	exit $err
fi
