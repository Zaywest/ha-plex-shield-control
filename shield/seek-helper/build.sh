#!/usr/bin/env bash
# Rebuilds seek.dex from Seek.java. Needs a JDK (17+) and Google's d8/r8 jar:
#   https://dl.google.com/android/maven2/com/android/tools/r8/<version>/r8-<version>.jar
# Seek.java uses only reflection, so no Android SDK / android.jar is required.
set -euo pipefail
cd "$(dirname "$0")"
R8_JAR="${R8_JAR:?set R8_JAR to the path of r8-<version>.jar}"
rm -rf classes && mkdir classes
javac --release 8 -d classes Seek.java
java -cp "$R8_JAR" com.android.tools.r8.D8 --min-api 26 --output . classes/tv/plex/Seek.class
mv classes.dex seek.dex
rm -rf classes
echo "built $(pwd)/seek.dex"
