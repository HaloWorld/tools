# Source this file from Fish to enable ut-* commands from this repository.
set -l repo_dir (dirname (dirname (status --current-filename)))
fish_add_path "$repo_dir/bin"
