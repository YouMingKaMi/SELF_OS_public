"""Xcode project for the design-study app (CouncilStudio). Shares only the CouncilCore package
with the main app; its UI lives entirely in apps/ios/CouncilStudio. Re-run after adding files."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parent.parent / 'apps/ios'
uid = lambda s: hashlib.sha1(('studio:' + s).encode()).hexdigest()[:24].upper()
objects = []
def obj(key, value):
    objects.append(f'{uid(key)} = {{ {value} }};')
    return uid(key)
sources, refs = [], []
for path in sorted((root / 'CouncilStudio').rglob('*.swift')):
    name = str(path.relative_to(root))
    ref = obj(name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "{name}"; sourceTree = "<group>";')
    refs.append(ref)
    sources.append(obj('build' + name, f'isa = PBXBuildFile; fileRef = {ref};'))
fixture = obj('fixtures', 'isa = PBXFileReference; lastKnownFileType = text.json; path = "CouncilApp/Generated/demo-fixtures.json"; sourceTree = "<group>";')
fixturebuild = obj('fixturebuild', f'isa = PBXBuildFile; fileRef = {fixture};')
# App icon: one 1024 image; Xcode derives every size.
assets = obj('assets', 'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = "CouncilStudio/Assets.xcassets"; sourceTree = "<group>";')
assetsbuild = obj('assetsbuild', f'isa = PBXBuildFile; fileRef = {assets};')
product = obj('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = "CouncilStudio.app"; sourceTree = BUILT_PRODUCTS_DIR;')
package = obj('corepackage', 'isa = XCLocalSwiftPackageReference; relativePath = CouncilCore;')
packageproduct = obj('coreproduct', 'isa = XCSwiftPackageProductDependency; productName = CouncilCore;')
packagebuild = obj('corebuild', f'isa = PBXBuildFile; productRef = {packageproduct};')
sourcephase = obj('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(sources)}); runOnlyForDeploymentPostprocessing = 0;')
resourcephase = obj('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({fixturebuild},{assetsbuild}); runOnlyForDeploymentPostprocessing = 0;')
frameworkphase = obj('frameworks', f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({packagebuild}); runOnlyForDeploymentPostprocessing = 0;')
group = obj('group', f'isa = PBXGroup; children = ({",".join(refs + [fixture, assets, product])}); sourceTree = "<group>";')
settings = ('PRODUCT_BUNDLE_IDENTIFIER = org.personalcouncil.next.studio; PRODUCT_NAME = CouncilStudio; '
            'SWIFT_VERSION = 6.0; IPHONEOS_DEPLOYMENT_TARGET = 18.0; GENERATE_INFOPLIST_FILE = YES; '
            'INFOPLIST_FILE = CouncilStudio/Info.plist; TARGETED_DEVICE_FAMILY = 1; '
            'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; MARKETING_VERSION = 0.3.0; CURRENT_PROJECT_VERSION = 1; CODE_SIGN_STYLE = Automatic;')
configs, pconfigs = [], []
for name in ['Debug', 'Release']:
    configs.append(obj('target' + name, f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ {settings} }};'))
    pconfigs.append(obj('project' + name, f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ SDKROOT = iphoneos; CLANG_ENABLE_MODULES = YES; }};'))
targetlist = obj('targetlist', f'isa = XCConfigurationList; buildConfigurations = ({",".join(configs)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
projectlist = obj('projectlist', f'isa = XCConfigurationList; buildConfigurations = ({",".join(pconfigs)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
target = obj('target', f'isa = PBXNativeTarget; name = CouncilStudio; buildConfigurationList = {targetlist}; buildPhases = ({sourcephase},{resourcephase},{frameworkphase}); buildRules = (); dependencies = (); packageProductDependencies = ({packageproduct}); productName = CouncilStudio; productReference = {product}; productType = "com.apple.product-type.application";')
project = obj('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; }}; buildConfigurationList = {projectlist}; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh_CN; hasScannedForEncodings = 0; knownRegions = (en,zh_CN,Base); mainGroup = {group}; packageReferences = ({package}); projectDirPath = ""; projectRoot = ""; targets = ({target});')
folder = root / 'CouncilStudio.xcodeproj'
folder.mkdir(exist_ok=True)
(folder / 'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(objects) + f'\n}}; rootObject = {project}; }}\n')
schemes = folder / 'xcshareddata/xcschemes'
schemes.mkdir(parents=True, exist_ok=True)
(schemes / 'CouncilStudio.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="CouncilStudio.app" BlueprintName="CouncilStudio" ReferencedContainer="container:CouncilStudio.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="CouncilStudio.app" BlueprintName="CouncilStudio" ReferencedContainer="container:CouncilStudio.xcodeproj"/></BuildableProductRunnable></LaunchAction></Scheme>
''')
print('generated', len(sources), 'sources')
