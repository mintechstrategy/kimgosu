#!/usr/bin/env python3
"""Build a real SwiftUI simulator .app with the installed Xcode SDK."""
from pathlib import Path
import plistlib,subprocess
ROOT=Path(__file__).resolve().parent
app=ROOT/'build/KimgosuDiagnostic.app'
app.mkdir(parents=True,exist_ok=True)
info={'CFBundleIdentifier':'ai.mintech.kimgosu.diagnostic','CFBundleName':'KimgosuDiagnostic','CFBundleExecutable':'KimgosuDiagnostic','CFBundlePackageType':'APPL','CFBundleShortVersionString':'0.0.1','CFBundleVersion':'1','MinimumOSVersion':'17.0','LSRequiresIPhoneOS':True,'UILaunchScreen':{},'UIDeviceFamily':[1,2]}
(app/'Info.plist').write_bytes(plistlib.dumps(info))
sdk=subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-path'],text=True).strip()
subprocess.run(['xcrun','--sdk','iphonesimulator','swiftc','-parse-as-library','-target','arm64-apple-ios17.0-simulator','-sdk',sdk,str(ROOT/'DiagnosticApp.swift'),'-o',str(app/'KimgosuDiagnostic')],check=True)
subprocess.run(['codesign','--force','--sign','-',str(app)],check=True)
print(app)
