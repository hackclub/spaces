
"""
Piston Service - Handles code execution for multiple languages using the Piston API
"""

import requests
import json
import logging
from typing import Dict, List, Optional, Any, Union

logger = logging.getLogger(__name__)

PISTON_API_BASE = "http://compute.hackclub.space/api/v2"
RUNTIMES_ENDPOINT = f"{PISTON_API_BASE}/runtimes"
EXECUTE_ENDPOINT = f"{PISTON_API_BASE}/execute"

# Default execution limits
DEFAULT_COMPILE_TIMEOUT = 10000  # 10 seconds in milliseconds
DEFAULT_RUN_TIMEOUT = 3000  # 3 seconds in milliseconds
DEFAULT_MEMORY_LIMIT = -1  # No limit

class PistonService:
    """Service for executing code using the Piston API."""
    
    _runtimes_cache = None
    _runtimes_by_language = None
    
    @classmethod
    def get_runtimes(cls, force_refresh=False) -> List[Dict[str, Any]]:
        """Get available runtimes from Piston API with caching."""
        if cls._runtimes_cache is None or force_refresh:
            try:
                response = requests.get(RUNTIMES_ENDPOINT)
                response.raise_for_status()
                cls._runtimes_cache = response.json()
                
                # Create a lookup by language
                cls._runtimes_by_language = {}
                for runtime in cls._runtimes_cache:
                    lang = runtime['language']
                    if lang not in cls._runtimes_by_language:
                        cls._runtimes_by_language[lang] = []
                    cls._runtimes_by_language[lang].append(runtime)
                
            except Exception as e:
                logger.error(f"Error fetching Piston runtimes: {str(e)}")
                # Use hardcoded languages if API call fails
                cls._runtimes_cache = cls._get_hardcoded_runtimes()
                cls._runtimes_by_language = cls._get_hardcoded_languages_map()
        
        return cls._runtimes_cache
    
    @classmethod
    def _get_hardcoded_runtimes(cls) -> List[Dict[str, Any]]:
        """Get hardcoded list of runtimes if API call fails."""
        return [
            {"language": "python", "version": "3.12.0"},
            {"language": "java", "version": "15.0.2"},
            {"language": "go", "version": "1.16.2"},
            {"language": "ruby", "version": "3.0.1"},
            {"language": "rust", "version": "1.68.2"},
            {"language": "php", "version": "8.2.3"},
            {"language": "typescript", "version": "5.0.3"},
            {"language": "swift", "version": "5.3.3"},
            {"language": "kotlin", "version": "1.8.20"},
            {"language": "bash", "version": "5.2.0"},
            {"language": "javascript", "version": "20.11.1"},
            {"language": "c", "version": "10.2.0"},
            {"language": "cpp", "version": "10.2.0"},
            {"language": "d", "version": "10.2.0"},
            {"language": "fortran", "version": "10.2.0"},
            {"language": "basic.net", "version": "5.0.201"},
            {"language": "fsharp.net", "version": "5.0.201"},
            {"language": "csharp.net", "version": "5.0.201"},
            {"language": "fsi", "version": "5.0.201"}
        ]
    
    @classmethod
    def _get_hardcoded_languages_map(cls) -> Dict[str, List[Dict[str, Any]]]:
        """Get hardcoded languages map if API call fails."""
        runtimes = cls._get_hardcoded_runtimes()
        languages_map = {}
        
        for runtime in runtimes:
            lang = runtime['language']
            if lang not in languages_map:
                languages_map[lang] = []
            languages_map[lang].append(runtime)
        
        return languages_map
    
    @classmethod
    def get_languages(cls) -> List[str]:
        """Get a list of available programming languages."""
        cls.get_runtimes()  # Ensure cache is populated
        if cls._runtimes_by_language:
            # Filter out inappropriate language names
            excluded_languages = ["brainfuck"]
            filtered_languages = [lang for lang in cls._runtimes_by_language.keys() 
                                if lang.lower() not in excluded_languages]
            return sorted(filtered_languages)
        return []
    
    @classmethod
    def get_language_versions(cls, language: str) -> List[str]:
        """Get available versions for a specific language."""
        cls.get_runtimes()  # Ensure cache is populated
        if cls._runtimes_by_language and language in cls._runtimes_by_language:
            return [runtime['version'] for runtime in cls._runtimes_by_language[language]]
        return []
    
    @classmethod
    def get_latest_version(cls, language: str) -> Optional[str]:
        """Get the latest version for a specific language."""
        versions = cls.get_language_versions(language)
        return versions[0] if versions else None
    
    @classmethod
    def execute_code(cls, 
                     language: str, 
                     code: str, 
                     version: Optional[str] = None,
                     stdin: str = "",
                     args: List[str] = None) -> Dict[str, Any]:
        """
        Execute code using the Piston API.
        
        Args:
            language: Programming language to use
            code: Source code to execute
            version: Specific version to use (optional, uses latest if not specified)
            stdin: Standard input to provide to the program
            args: Command line arguments to pass to the program
            
        Returns:
            Dictionary containing execution results
        """
        if args is None:
            args = []
            
        # Get the latest version if not specified
        if not version:
            version = cls.get_latest_version(language)
            if not version:
                return {
                    "success": False,
                    "error": f"Language '{language}' not supported or no version available"
                }
        
        # Prepare the request payload - ensure we get the extension correctly
        file_ext = cls._get_file_extension(language.lower())
        logger.info(f"Using extension '{file_ext}' for language '{language}'")
        
        payload = {
            "language": language,
            "version": version,
            "files": [
                {
                    "name": f"main.{file_ext}",
                    "content": code
                }
            ],
            "stdin": stdin,
            "args": args,
            "compile_timeout": DEFAULT_COMPILE_TIMEOUT,
            "run_timeout": DEFAULT_RUN_TIMEOUT,
            "compile_memory_limit": DEFAULT_MEMORY_LIMIT,
            "run_memory_limit": DEFAULT_MEMORY_LIMIT
        }
        
        try:
            response = requests.post(EXECUTE_ENDPOINT, json=payload)
            response.raise_for_status()
            result = response.json()
            
            # Format the response for our application
            output = {
                "success": True,
                "language": language,
                "version": version,
                "output": "",
                "error": None,
                "execution_time": 0
            }
            
            # Extract run output
            if "run" in result:
                run_data = result["run"]
                output["output"] = run_data.get("stdout", "")
                
                # Add stderr if present
                if run_data.get("stderr"):
                    if output["output"]:
                        output["output"] += "\n"
                    output["output"] += run_data["stderr"]
                
                # Check for errors
                if run_data.get("code") != 0 or run_data.get("signal"):
                    output["error"] = run_data.get("stderr") or "Execution failed"
                
                # Add execution time
                output["execution_time"] = run_data.get("wall_time", 0)
            
            # Extract compile output if present
            if "compile" in result:
                compile_data = result["compile"]
                
                # Add compile errors if present
                if compile_data.get("stderr"):
                    output["error"] = compile_data["stderr"]
                    output["success"] = False
                
                # Add compile output if present
                if compile_data.get("stdout"):
                    if output["output"]:
                        output["output"] = compile_data["stdout"] + "\n" + output["output"]
                    else:
                        output["output"] = compile_data["stdout"]
            
            return output
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Error executing code with Piston: {str(e)}")
            return {
                "success": False,
                "error": f"Error connecting to code execution service: {str(e)}"
            }
        except Exception as e:
            logger.error(f"Unexpected error in execute_code: {str(e)}")
            return {
                "success": False,
                "error": f"Unexpected error: {str(e)}"
            }
    
    @classmethod
    def get_language_icon(cls, language: str) -> str:
        """Get the appropriate Font Awesome icon class for a language."""
        icon_map = {
            # Specified languages with their icons
            "python": "fab fa-python",
            "javascript": "fab fa-js",
            "typescript": "fab fa-js-square",
            "java": "fab fa-java",
            "c": "fas fa-code",
            "cpp": "fas fa-code",
            "c++": "fas fa-code",
            "csharp.net": "fab fa-microsoft",
            "go": "fab fa-golang",
            "ruby": "fas fa-gem",
            "rust": "fas fa-cogs",
            "php": "fab fa-php",
            "swift": "fab fa-swift",
            "kotlin": "fab fa-android",
            "d": "fas fa-code",
            "fortran": "fas fa-calculator",
            "basic.net": "fab fa-microsoft",
            "fsharp.net": "fab fa-microsoft",
            "fsi": "fab fa-microsoft",
            
            # Scripting languages
            "bash": "fas fa-terminal"
        }
        return icon_map.get(language.lower(), "fas fa-code")

    @classmethod
    def get_codemirror_mode(cls, language: str) -> str:
        """Get the CodeMirror mode for a given language."""
        mode_map = {
            # Specified languages with their modes
            "python": "python",
            "javascript": "javascript",
            "typescript": "javascript",
            "java": "clike",
            "c": "clike",
            "c++": "clike",
            "cpp": "clike",
            "csharp.net": "clike",
            "go": "go",
            "ruby": "ruby",
            "rust": "rust",
            "php": "php",
            "swift": "swift",
            "kotlin": "clike",
            "bash": "shell",
            "d": "d",
            "fortran": "fortran",
            "basic.net": "vb",
            "fsharp.net": "mllike",
            "fsi": "mllike"
        }
        return mode_map.get(language.lower(), "text/plain")

    @classmethod
    def get_language_extension(cls, language: str) -> str:
        """Get the file extension for a given language."""
        language = language.lower()  # Normalize to lowercase
        extension_map = {
            # Specified languages with their extensions
            "python": "py",
            "javascript": "js",
            "typescript": "ts",
            "java": "java",
            "c": "c",
            "c++": "cpp",
            "cpp": "cpp",
            "csharp.net": "cs",
            "go": "go",
            "ruby": "rb",
            "rust": "rs",
            "php": "php",
            "swift": "swift",
            "kotlin": "kt",
            "bash": "sh",
            "d": "d",
            "fortran": "f90",
            "basic.net": "vb",
            "fsharp.net": "fs",
            "fsi": "fsx"
        }
        extension = extension_map.get(language, "txt")
        logger.info(f"Language extension for '{language}': '{extension}'")
        return extension
    
    @staticmethod
    def _get_file_extension(language: str) -> str:
        """Get the appropriate file extension for a language."""
        language = language.lower()  # Normalize language to lowercase
        extension_map = {
            # Specified languages with their extensions
            "python": "py",
            "javascript": "js",
            "typescript": "ts",
            "java": "java",
            "c": "c",
            "cpp": "cpp",
            "c++": "cpp",
            "csharp.net": "cs",
            "go": "go",
            "ruby": "rb",
            "rust": "rs",
            "php": "php",
            "swift": "swift",
            "kotlin": "kt",
            "bash": "sh",
            "d": "d",
            "fortran": "f90",
            "basic.net": "vb",
            "fsharp.net": "fs",
            "fsi": "fsx"
        }
        
        # Special handling for known languages to ensure they always get proper extensions
        if language in ["c++", "cpp"]:
            return "cpp"
        elif language in ["python", "python2", "python3"]:
            return "py"
        elif language in ["javascript", "js"]:
            return "js"
        elif language in ["typescript", "ts"]:
            return "ts"
        elif language in ["csharp.net"]:
            return "cs"
            
        # Get appropriate extension without adding a period
        return extension_map.get(language, "txt")
    
    @classmethod
    def get_language_template(cls, language: str) -> str:
        """Get a code template for the specified language."""
        templates = {
            "python": '''# Welcome to your Python space!

def main():
    """Main function that runs when this script is executed."""
    print("Hello, World!")

    # Try adding your own code below:
    name = "Python Coder"
    print(f"Welcome, {name}!")

    # You can use loops:
    for i in range(3):
        print(f"Count: {i}")

    # And conditions:
    if name == "Python Coder":
        print("You're a Python coder!")
    else:
        print("You can become a Python coder!")

# Standard Python idiom to call the main function
if __name__ == "__main__":
    main()
''',
            "javascript": '''// Welcome to your JavaScript space!

function main() {
    console.log("Hello, World!");
    
    // Try adding your own code below:
    const name = "JavaScript Coder";
    console.log(`Welcome, ${name}!`);
    
    // You can use loops:
    for (let i = 0; i < 3; i++) {
        console.log(`Count: ${i}`);
    }
    
    // And conditions:
    if (name === "JavaScript Coder") {
        console.log("You're a JavaScript coder!");
    } else {
        console.log("You can become a JavaScript coder!");
    }
}

// Call the main function
main();
''',
            "java": '''// Welcome to your Java space!

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
        
        // Try adding your own code below:
        String name = "Java Coder";
        System.out.println("Welcome, " + name + "!");
        
        // You can use loops:
        for (int i = 0; i < 3; i++) {
            System.out.println("Count: " + i);
        }
        
        // And conditions:
        if (name.equals("Java Coder")) {
            System.out.println("You're a Java coder!");
        } else {
            System.out.println("You can become a Java coder!");
        }
    }
}
''',
            "c": '''// Welcome to your C space!
#include <stdio.h>
#include <string.h>

int main() {
    printf("Hello, World!\\n");
    
    // Try adding your own code below:
    char name[] = "C Coder";
    printf("Welcome, %s!\\n", name);
    
    // You can use loops:
    for (int i = 0; i < 3; i++) {
        printf("Count: %d\\n", i);
    }
    
    // And conditions:
    if (strcmp(name, "C Coder") == 0) {
        printf("You're a C coder!\\n");
    } else {
        printf("You can become a C coder!\\n");
    }
    
    return 0;
}
''',
            "cpp": '''// Welcome to your C++ space!
#include <iostream>
#include <string>

int main() {
    std::cout << "Hello, World!" << std::endl;
    
    // Try adding your own code below:
    std::string name = "C++ Coder";
    std::cout << "Welcome, " << name << "!" << std::endl;
    
    // You can use loops:
    for (int i = 0; i < 3; i++) {
        std::cout << "Count: " << i << std::endl;
    }
    
    // And conditions:
    if (name == "C++ Coder") {
        std::cout << "You're a C++ coder!" << std::endl;
    } else {
        std::cout << "You can become a C++ coder!" << std::endl;
    }
    
    return 0;
}
''',
            "c++": '''// Welcome to your C++ space!
#include <iostream>
#include <string>

int main() {
    std::cout << "Hello, World!" << std::endl;
    
    // Try adding your own code below:
    std::string name = "C++ Coder";
    std::cout << "Welcome, " << name << "!" << std::endl;
    
    // You can use loops:
    for (int i = 0; i < 3; i++) {
        std::cout << "Count: " << i << std::endl;
    }
    
    // And conditions:
    if (name == "C++ Coder") {
        std::cout << "You're a C++ coder!" << std::endl;
    } else {
        std::cout << "You can become a C++ coder!" << std::endl;
    }
    
    return 0;
}
''',
            "csharp.net": '''// Welcome to your C# space!
using System;

class Program {
    static void Main() {
        Console.WriteLine("Hello, World!");
        
        // Try adding your own code below:
        string name = "C# Coder";
        Console.WriteLine($"Welcome, {name}!");
        
        // You can use loops:
        for (int i = 0; i < 3; i++) {
            Console.WriteLine($"Count: {i}");
        }
        
        // And conditions:
        if (name == "C# Coder") {
            Console.WriteLine("You're a C# coder!");
        } else {
            Console.WriteLine("You can become a C# coder!");
        }
    }
}
''',
            "go": '''// Welcome to your Go space!
package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
    
    // Try adding your own code below:
    name := "Go Coder"
    fmt.Printf("Welcome, %s!\\n", name)
    
    // You can use loops:
    for i := 0; i < 3; i++ {
        fmt.Printf("Count: %d\\n", i)
    }
    
    // And conditions:
    if name == "Go Coder" {
        fmt.Println("You're a Go coder!")
    } else {
        fmt.Println("You can become a Go coder!")
    }
}
''',
            "ruby": '''# Welcome to your Ruby space!

def main
  puts "Hello, World!"
  
  # Try adding your own code below:
  name = "Ruby Coder"
  puts "Welcome, #{name}!"
  
  # You can use loops:
  3.times do |i|
    puts "Count: #{i}"
  end
  
  # And conditions:
  if name == "Ruby Coder"
    puts "You're a Ruby coder!"
  else
    puts "You can become a Ruby coder!"
  end
end

# Call the main function
main
''',
            "rust": '''// Welcome to your Rust space!

fn main() {
    println!("Hello, World!");
    
    // Try adding your own code below:
    let name = "Rust Coder";
    println!("Welcome, {}!", name);
    
    // You can use loops:
    for i in 0..3 {
        println!("Count: {}", i);
    }
    
    // And conditions:
    if name == "Rust Coder" {
        println!("You're a Rust coder!");
    } else {
        println!("You can become a Rust coder!");
    }
}
''',
            "typescript": '''// Welcome to your TypeScript space!

function main(): void {
    console.log("Hello, World!");
    
    // Try adding your own code below:
    const name: string = "TypeScript Coder";
    console.log(`Welcome, ${name}!`);
    
    // You can use loops:
    for (let i: number = 0; i < 3; i++) {
        console.log(`Count: ${i}`);
    }
    
    // And conditions:
    if (name === "TypeScript Coder") {
        console.log("You're a TypeScript coder!");
    } else {
        console.log("You can become a TypeScript coder!");
    }
}

// Call the main function
main();
''',
            "php": '''<?php
// Welcome to your PHP space!

function main() {
    echo "Hello, World!\\n";
    
    // Try adding your own code below:
    $name = "PHP Coder";
    echo "Welcome, $name!\\n";
    
    // You can use loops:
    for ($i = 0; $i < 3; $i++) {
        echo "Count: $i\\n";
    }
    
    // And conditions:
    if ($name == "PHP Coder") {
        echo "You're a PHP coder!\\n";
    } else {
        echo "You can become a PHP coder!\\n";
    }
}

// Call the main function
main();
?>
''',
            "swift": '''// Welcome to your Swift space!

func main() {
    print("Hello, World!")
    
    // Try adding your own code below:
    let name = "Swift Coder"
    print("Welcome, \\(name)!")
    
    // You can use loops:
    for i in 0..<3 {
        print("Count: \\(i)")
    }
    
    // And conditions:
    if name == "Swift Coder" {
        print("You're a Swift coder!")
    } else {
        print("You can become a Swift coder!")
    }
}

// Call the main function
main()
''',
            "kotlin": '''// Welcome to your Kotlin space!

fun main() {
    println("Hello, World!")
    
    // Try adding your own code below:
    val name = "Kotlin Coder"
    println("Welcome, $name!")
    
    // You can use loops:
    for (i in 0..2) {
        println("Count: $i")
    }
    
    // And conditions:
    if (name == "Kotlin Coder") {
        println("You're a Kotlin coder!")
    } else {
        println("You can become a Kotlin coder!")
    }
}
''',
            "bash": '''#!/bin/bash
# Welcome to your Bash space!

# Main function
main() {
    echo "Hello, World!"
    
    # Try adding your own code below:
    name="Bash Coder"
    echo "Welcome, $name!"
    
    # You can use loops:
    for i in {0..2}; do
        echo "Count: $i"
    done
    
    # And conditions:
    if [ "$name" == "Bash Coder" ]; then
        echo "You're a Bash coder!"
    else
        echo "You can become a Bash coder!"
    fi
}

# Call the main function
main
''',
            "d": '''// Welcome to your D space!
import std.stdio;

void main() {
    writeln("Hello, World!");
    
    // Try adding your own code below:
    string name = "D Coder";
    writeln("Welcome, ", name, "!");
    
    // You can use loops:
    for (int i = 0; i < 3; i++) {
        writeln("Count: ", i);
    }
    
    // And conditions:
    if (name == "D Coder") {
        writeln("You're a D coder!");
    } else {
        writeln("You can become a D coder!");
    }
}
''',
            "fortran": '''! Welcome to your Fortran space!
program hello
    implicit none
    character(len=20) :: name
    integer :: i
    
    print *, "Hello, World!"
    
    ! Try adding your own code below:
    name = "Fortran Coder"
    print *, "Welcome, ", trim(name), "!"
    
    ! You can use loops:
    do i = 0, 2
        print *, "Count: ", i
    end do
    
    ! And conditions:
    if (name == "Fortran Coder") then
        print *, "You're a Fortran coder!"
    else
        print *, "You can become a Fortran coder!"
    end if
end program hello
''',
            "basic.net": '''' Welcome to your Visual Basic space!
Imports System

Module Program
    Sub Main()
        Console.WriteLine("Hello, World!")
        
        ' Try adding your own code below:
        Dim name As String = "VB Coder"
        Console.WriteLine("Welcome, " & name & "!")
        
        ' You can use loops:
        For i As Integer = 0 To 2
            Console.WriteLine("Count: " & i)
        Next
        
        ' And conditions:
        If name = "VB Coder" Then
            Console.WriteLine("You're a VB coder!")
        Else
            Console.WriteLine("You can become a VB coder!")
        End If
    End Sub
End Module
''',
            "fsharp.net": '''// Welcome to your F# space!
open System

let main() =
    printfn "Hello, World!"
    
    // Try adding your own code below:
    let name = "F# Coder"
    printfn "Welcome, %s!" name
    
    // You can use loops:
    for i in 0..2 do
        printfn "Count: %d" i
    
    // And conditions:
    if name = "F# Coder" then
        printfn "You're an F# coder!"
    else
        printfn "You can become an F# coder!"

// Call the main function
main()
''',
            "fsi": '''// Welcome to your F# Interactive space!
open System

let name = "F# Coder"
printfn "Hello, World!"
printfn "Welcome, %s!" name

// You can use loops:
for i in 0..2 do
    printfn "Count: %d" i

// And conditions:
if name = "F# Coder" then
    printfn "You're an F# coder!"
else
    printfn "You can become an F# coder!"
'''
        }
        
        # For languages not in the explicit templates, generate a generic template
        if language in templates:
            return templates[language]
        
        # Generate generic templates for languages that don't have a specific template
        language_capitalized = language.capitalize()
        
        # Group languages by syntax family to generate appropriate templates
        if language in ["javascript", "typescript", "coffeescript", "dart", "solidity"]:
            return f"// Welcome to your {language_capitalized} space!\n\nfunction main() {{\n  console.log(\"Hello, World!\");\n\n  // Write your code here\n}}\n\nmain();\n"
        
        elif language in ["python", "ruby", "crystal", "nim"]:
            return f"# Welcome to your {language_capitalized} space!\n\ndef main():\n    print(\"Hello, World!\")\n    \n    # Write your code here\n\n# Call the main function\nmain()\n"
        
        elif language in ["lua", "moonscript"]:
            return f"-- Welcome to your {language_capitalized} space!\n\nfunction main()\n    print(\"Hello, World!\")\n    \n    -- Write your code here\nend\n\nmain()\n"
        
        elif language in ["c", "cpp", "c++", "java", "csharp.net", "d", "rust", "go", "swift", "kotlin"]:
            main_func = f"func" if language == 'go' else ("int" if language in ['c', 'cpp', 'c++'] else "void")
            return_str = f"// Welcome to your {language_capitalized} space!\n\n// Main function\n{main_func} main() {{\n    // Write your code here\n    printf(\"Hello, World!\\\\n\");\n"
            if language in ['c', 'cpp', 'c++']:
                return_str += "    return 0;\n"
            return_str += "}}\n"
            return return_str
        
        elif language in ["bash", "powershell", "shell"]:
            prefix = "#!" + ("/bin/bash" if language == "bash" else "")
            return f"{prefix}\n# Welcome to your {language_capitalized} space!\n\nfunction main() {{\n    echo \"Hello, World!\"\n    \n    # Write your code here\n}}\n\n# Call the main function\nmain\n"
        
        elif language in ["r", "rscript"]:
            return f"# Welcome to your R space!\n\nmain <- function() {{\n  print(\"Hello, World!\")\n  \n  # Write your code here\n}}\n\n# Call the main function\nmain()\n"
        
        elif language in ["php"]:
            return f"<?php\n// Welcome to your PHP space!\n\nfunction main() {{\n    echo \"Hello, World!\\n\";\n    \n    // Write your code here\n}}\n\n// Call the main function\nmain();\n?>\n"
        
        elif language in ["haskell", "fsharp.net", "ocaml", "elm"]:
            return f"-- Welcome to your {language_capitalized} space!\n\nmain = do\n  putStrLn \"Hello, World!\"\n  \n  -- Write your code here\n\n-- Execute main function\nmain\n"
        
        elif language in ["clojure", "scheme", "racket", "lisp"]:
            return f";;; Welcome to your {language_capitalized} space!\n\n(defn main []\n  (println \"Hello, World!\")\n  \n  ;; Write your code here\n)\n\n;; Call the main function\n(main)\n"
        
        elif language == "html":
            return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My {language_capitalized} Space</title>
    <style>
        body {{
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            max-width: 800px;
            margin: 0 auto;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome to my {language_capitalized} Space!</h1>
        <p>Edit this template and make it your own!</p>
    </div>
</body>
</html>'''
        
        elif language == "css":
            return f'''/* Welcome to your CSS Space */

body {{
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 0;
    background-color: #f5f5f5;
}}

.container {{
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}}

h1 {{
    color: #333;
}}

p {{
    line-height: 1.6;
}}
'''
        
        # Default template for any other language
        return f"// Welcome to your {language_capitalized} space!\n\n// Write your code here\nprint(\"Hello, World!\");\n"
