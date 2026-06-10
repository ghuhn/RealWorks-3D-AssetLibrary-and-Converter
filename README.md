# UNIVERSAL USD ASSET CONVERTER - INSTALLATION GUIDE

Welcome to the Universal USD Asset Converter project! Because this application acts as an orchestrator for Blender and local file systems, there are a few prerequisites you need to install before the app will function.

## STEP 1: PREREQUISITES

Before building the app, ensure you have the following installed on your machine:
1. Node.js (v18 or higher)
2. Rust & Cargo (https://rustup.rs/)
3. Blender (v3.6 or higher recommended - https://www.blender.org/download/)

## STEP 2: BUILD & RUN THE APP

Open your terminal, navigate to the root directory of this repository, and run the following commands:

### 1. Install all frontend dependencies

```bash
npm install
```

### 2. Launch the application in development mode

```bash
npm run tauri dev
```

The first time you run this command, Cargo will download and compile all the Rust backend crates. This may take a few minutes. Once finished, the Desktop Application window will automatically open.


## STEP 3: CONFIGURE THE APP

The app is now running, but it doesn't know where Blender is or where to save files!

1. Click the "Settings" button in the application.
2. Blender Executable Path: Provide the absolute path to your Blender executable.
   - Windows Example: C:\Program Files\Blender Foundation\Blender 4.0\blender.exe
   - Mac Example: /Applications/Blender.app/Contents/MacOS/Blender
3. Library Directory: Create an empty folder on your computer to store your USD assets, and paste its path here.
4. Gemini API Key (Optional): If you want the app's AI to automatically fix broken texture links on assets that have loose textures, you must generate a free API key from Google AI Studio (https://aistudio.google.com/app/apikey) and paste it here.

Click "Save Settings".


## STEP 4: TEST THE PIPELINE

You are ready to go! 
1. Click "Import Asset" and select any .obj, .fbx, or .glb file.
2. Watch the terminal where you ran `npm run tauri dev` to see the background Python scripts rebuilding the materials and exporting the USD.
3. The converted USD will instantly appear in your UI!
