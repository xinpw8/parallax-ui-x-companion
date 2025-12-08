
#!/bin/bash
set -e

echo "Updating system..."
apt-get update && apt-get install -y git software-properties-common

echo "Installing Python 3.11..."
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update
apt-get install -y python3.11 python3.11-venv python3.11-dev

echo "Setting up Python 3.11 environment..."
python3.11 -m ensurepip --upgrade
python3.11 -m pip install --upgrade pip

echo "Installing Parallax from GitHub..."
python3.11 -m pip install git+https://github.com/GradientHQ/parallax.git

echo "Parallax installed. Version:"
python3.11 -m parallax --help || true

echo "Starting Parallax with Qwen3-0.6B..."
python3.11 -m parallax run -m Qwen/Qwen3-0.6B
