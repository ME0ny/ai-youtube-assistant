# merge-files.ps1
# Merges all text files into one, skips media and self
# Works with paths containing Cyrillic (e.g. D:\разработка\)
# Output: all_code.txt (UTF-8 without BOM)

$outFile = "all_code.txt"
$thisScript = $MyInvocation.MyCommand.Name

# Extensions to skip
$mediaExtensions = @(
    ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".ico",
    ".mp3", ".wav", ".flac", ".aac", ".ogg",
    ".mp4", ".avi", ".mov", ".mkv", ".wmv", ".webm",
    ".pdf", ".psd", ".ai", ".eps", ".csv", ".txt"
)

# Directories to exclude (relative to the script's location)
$excludeDirs = @(
    "lib"  # Add more directories here if needed, e.g., ".git", "dist"
    # ".git"
    # "build"
)

# Full output path
$outputPath = Join-Path (Get-Location) $outFile

# Remove existing file
if (Test-Path $outputPath) {
    Remove-Item $outputPath -Force
    Write-Host "Removed old file: $outFile"
}

# UTF-8 without BOM
$utf8 = New-Object System.Text.UTF8Encoding $false

# Create StreamWriter
try {
    $writer = New-Object System.IO.StreamWriter($outputPath, $false, $utf8)
    Write-Host "Created output file: $outFile"
}
catch {
    Write-Host "ERROR: Failed to create file: $_"
    exit 1
}

# Get all files, excluding specified directories and file types
# Use ForEach-Object to filter out paths containing excluded directories
$allFiles = Get-ChildItem -Recurse -File | Where-Object {
    ($mediaExtensions -notcontains $_.Extension.ToLower()) -and
    ($_.Name -ine $outFile) -and
    ($_.Name -ine $thisScript)
}

# Filter files based on excluded directories
$files = $allFiles | Where-Object {
    $currentFile = $_
    $isExcluded = $false
    foreach ($dir in $excludeDirs) {
        # Check if the file's full path contains the excluded directory
        # Make sure the comparison is robust (case-insensitive, handles relative paths)
        if ($currentFile.FullName -like "*\$dir*" -or $currentFile.FullName -like "*\\$dir*") {
            $isExcluded = $true
            break
        }
    }
    -not $isExcluded
}

$total = $files.Count
$counter = 0

foreach ($file in $files) {
    $counter++
    Write-Progress -Activity "Merging files" `
                   -Status "Processed $counter of $total" `
                   -PercentComplete (($counter / $total) * 100)

    Write-Host "[$counter / $total] Adding: $($file.FullName)"

    try {
        # Using relative path for the marker can be cleaner, but full path is also fine
        $writer.WriteLine("`n=== START FILE: $($file.FullName) ===`n")
        # Read file content as raw bytes/string to avoid newline issues, preserving encoding if possible (UTF8 assumed)
        # -Raw is crucial to get the exact content including newlines
        $content = Get-Content -Path $file.FullName -Encoding UTF8 -Raw -ErrorAction Stop
        $writer.Write($content)
        $writer.WriteLine("`n`n=== END FILE: $($file.FullName) ===`n")
        $writer.WriteLine("--------------------------------------------------------------------------------")
    }
    catch {
        # It's good practice to catch specific errors, but 'Stop' on Get-Content should make this mostly file access issues
        Write-Host "Warning: Could not read file: $($file.FullName) - $_"
        $writer.WriteLine("WARNING: Could not read file: $($file.FullName) - $_")
        # Optionally, write a separator even on failure to keep structure
        $writer.WriteLine("--------------------------------------------------------------------------------")
    }
}

# Close writer safely
try {
    $writer.Flush()
    $writer.Close()
    Write-Progress -Activity "Merging files" -Completed
    Write-Host "SUCCESS: All files merged into '$outFile'"
    Write-Host "Path: $outputPath"
}
catch {
    Write-Host "ERROR: Failed to close file stream: $_"
}
finally {
    # Ensure the writer is disposed even if Close() or Flush() throws
    if ($writer -ne $null) {
        $writer.Dispose()
    }
}