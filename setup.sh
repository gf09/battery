#!/bin/bash

#
# ‼️ SECURITY NOTES FOR MAINTAINERS:
#
# This app uses a visudo configuration that allows a background script running as
# an unprivileged user to execute battery management commands without requiring a
# user password. This requires careful installation and design to avoid potential
# privilege-escalation vulnerabilities.
#
# Rule of thumb:
# - Unprivileged users must not be able to modify, replace, or inject any code
#   that can be executed with root privileges.
#
# For this reason:
# - All battery-related binaries and scripts that are executed via sudo,
#   including those that prompt for a user password, must be owned by root.
# - They must not be writable by group or others.
# - Their parent directories must also be owned by root and not be writable by
#   unprivileged users, to prevent the replacement of executables.
#

# User welcome message
echo -e "\n####################################################################"
echo '# 👋 Welcome, this is the setup script for the battery CLI tool.'
echo -e "# Note: this script may ask for your password."
echo -e "####################################################################\n\n"

# Determine unprivileged user name
if [[ -n "$1" ]]; then
	calling_user="$1"
else
	if [[ -n "$SUDO_USER" ]]; then
		calling_user=$SUDO_USER
	else
		calling_user=$USER
	fi
fi
if [[ "$calling_user" == "root" ]]; then
	echo "❌ Failed to determine unprivileged username"
	exit 1
fi

# Set variables
tempfolder=/Users/$calling_user/.battery-tmp
binfolder=/usr/local/bin
configfolder=/Users/$calling_user/.battery
pidfile=$configfolder/battery.pid
logfile=$configfolder/battery.log
launch_agent_plist=/Users/$calling_user/Library/LaunchAgents/battery.plist

# Ask for sudo once, in most systems this will cache the permissions for a bit
sudo echo "🔋 Starting battery installation"
echo "[ 1 ] Superuser permissions acquired."

# Note: github names zips by <reponame>-<branchname>.replace( '/', '-' )
update_branch="main"
in_zip_folder_name="battery-$update_branch"
batteryfolder="$tempfolder/battery"

echo "[ 2 ] Downloading latest version of battery CLI"
rm -rf $batteryfolder
mkdir -p $batteryfolder
curl -sSL -o $batteryfolder/repo.zip "https://github.com/actuallymentor/battery/archive/refs/heads/$update_branch.zip"
unzip -qq $batteryfolder/repo.zip -d $batteryfolder
cp -r $batteryfolder/$in_zip_folder_name/* $batteryfolder
rm $batteryfolder/repo.zip

echo "[ 3 ] Make sure $binfolder exists and owned by root"
sudo install -d -m 755 -o root -g wheel "$binfolder"

echo "[ 4 ] Install prebuilt smc binary into $binfolder"
sudo install -m 755 -o root -g wheel "$batteryfolder/dist/smc" "$binfolder/smc"

echo "[ 5 ] Install battery script into $binfolder"
sudo install -m 755 -o root -g wheel "$batteryfolder/battery.sh" "$binfolder/battery"

echo "[ 6 ] Set ownership and permissions for $configfolder"
mkdir -p $configfolder
sudo chown -R $calling_user $configfolder
sudo chmod 755 $configfolder

touch $logfile
sudo chown $calling_user $logfile
sudo chmod 644 $logfile

touch $pidfile
sudo chown $calling_user $pidfile
sudo chmod 644 $pidfile

# Fix permissions for 'create_daemon' action
echo "[ 7 ] Fix ownership and permissions for $(dirname "$launch_agent_plist")"
sudo chown $calling_user "$(dirname "$launch_agent_plist")"
sudo chmod 755 "$(dirname "$launch_agent_plist")"
sudo chown -f $calling_user "$launch_agent_plist"

echo "[ 8 ] Setup visudo configuration"
sudo $binfolder/battery visudo
sudo chown -R $calling_user $configfolder

# Remove tempfiles
echo "[ 9 ] Remove temp folder $tempfolder"
rm -rf $tempfolder

echo -e "\n🎉 Battery tool installed. Type \"battery help\" for instructions.\n"
exit 0
