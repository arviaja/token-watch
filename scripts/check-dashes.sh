#!/usr/bin/env bash
# Fails when a text file holds an em dash (U+2014) or an en dash (U+2013).
# It checks the tracked files and the untracked files that git does not ignore.
# It skips binary files. It prints one line for each hit: file:line: text
#
# Needs git and perl. It uses no GNU-only option, so it runs with the default tools of macOS and Linux.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# The file names reach perl as raw bytes (NUL separated); the text of each file is read as UTF-8.
git ls-files -z --cached --others --exclude-standard | perl -CSD -e '
  use strict;
  use warnings;
  no warnings "utf8";

  binmode(STDIN, ":raw");
  my $names = do { local $/; <STDIN> };
  my $hits = 0;

  for my $file (split /\0/, $names) {
    # A tracked file that is deleted in the work tree, a folder (submodule) and a binary file are skipped
    next if !-f $file || -B $file;
    open(my $fh, "<:raw", $file) or next;
    # A NUL byte in the first 8000 bytes marks a binary file, also when the bytes are valid UTF-8
    read($fh, my $head, 8000);
    if ($head =~ /\0/) {
      close($fh);
      next;
    }
    seek($fh, 0, 0);
    binmode($fh, ":utf8");
    while (my $text = <$fh>) {
      next unless $text =~ /[\x{2013}\x{2014}]/;
      $text =~ s/\r?\n\z//;
      my $shown = $file;
      utf8::decode($shown);
      print "$shown:$.: $text\n";
      $hits++;
    }
    close($fh);
  }

  if ($hits > 0) {
    print STDERR "$hits line(s) with an em dash or an en dash. Use the ASCII hyphen-minus (-).\n";
    exit 1;
  }
'
