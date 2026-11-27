"""Xcode project for CouncilStudio and its widgets. Re-run after adding source files."""
from pathlib import Path
import hashlib
root = Path(__file__).resolve().parent.parent / 'apps/ios'
uid = lambda s: hashlib.sha1(('studio:' + s).encode()).hexdigest()[:24].upper()
objects = []
def obj(key, value):
    objects.append(f'{uid(key)} = {{ {value} }};')
    return uid(key)
sources, widget_sources, refs = [], [], []
for directory in ['CouncilStudio', 'CouncilWidgets']:
    for path in sorted((root / directory).rglob('*.swift')):
        name = str(path.relative_to(root))
        ref = obj(name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "{name}"; sourceTree = "<group>";')
        refs.append(ref)
        if directory == 'CouncilStudio' or path.name == 'WidgetTasks.swift':
            sources.append(obj('build' + name, f'isa = PBXBuildFile; fileRef = {ref};'))
        if directory == 'CouncilWidgets':
            widget_sources.append(obj('widgetbuild' + name, f'isa = PBXBuildFile; fileRef = {ref};'))
fixture = obj('fixtures', 'isa = PBXFileReference; lastKnownFileType = text.json; path = "CouncilStudio/Generated/demo-fixtures.json"; sourceTree = "<group>";')
fixturebuild = obj('fixturebuild', f'isa = PBXBuildFile; fileRef = {fixture};')
# App icon: one 1024 image; Xcode derives every size.
assets = obj('assets', 'isa = PBXFileReference; lastKnownFileType = folder.assetcatalog; path = "CouncilStudio/Assets.xcassets"; sourceTree = "<group>";')
assetsbuild = obj('assetsbuild', f'isa = PBXBuildFile; fileRef = {assets};')
product = obj('product', 'isa = PBXFileReference; explicitFileType = wrapper.application; path = "CouncilStudio.app"; sourceTree = BUILT_PRODUCTS_DIR;')
widget_product = obj('widgetproduct', 'isa = PBXFileReference; explicitFileType = wrapper.app-extension; path = "CouncilWidgets.appex"; sourceTree = BUILT_PRODUCTS_DIR;')
widget_embed = obj('widgetembed', f'isa = PBXBuildFile; fileRef = {widget_product}; settings = {{ ATTRIBUTES = (RemoveHeadersOnCopy); }};')
embed_phase = obj('embed', f'isa = PBXCopyFilesBuildPhase; buildActionMask = 2147483647; dstPath = ""; dstSubfolderSpec = 13; files = ({widget_embed}); name = "Embed App Extensions"; runOnlyForDeploymentPostprocessing = 0;')
package = obj('corepackage', 'isa = XCLocalSwiftPackageReference; relativePath = CouncilCore;')
packageproduct = obj('coreproduct', 'isa = XCSwiftPackageProductDependency; productName = CouncilCore;')
packagebuild = obj('corebuild', f'isa = PBXBuildFile; productRef = {packageproduct};')
sourcephase = obj('sources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(sources)}); runOnlyForDeploymentPostprocessing = 0;')
resourcephase = obj('resources', f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({fixturebuild},{assetsbuild}); runOnlyForDeploymentPostprocessing = 0;')
frameworkphase = obj('frameworks', f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({packagebuild}); runOnlyForDeploymentPostprocessing = 0;')
widget_package = obj('widgetcoreproduct', 'isa = XCSwiftPackageProductDependency; productName = CouncilCore;')
widget_packagebuild = obj('widgetcorebuild', f'isa = PBXBuildFile; productRef = {widget_package};')
widget_frameworks = obj('widgetframeworks', f'isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = ({widget_packagebuild}); runOnlyForDeploymentPostprocessing = 0;')
widget_sourcephase = obj('widgetsources', f'isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ({",".join(widget_sources)}); runOnlyForDeploymentPostprocessing = 0;')
group = obj('group', f'isa = PBXGroup; children = ({",".join(refs + [fixture, assets, product, widget_product])}); sourceTree = "<group>";')
settings = ('PRODUCT_BUNDLE_IDENTIFIER = org.personalcouncil.next.studio; PRODUCT_NAME = CouncilStudio; '
            'SWIFT_VERSION = 6.0; IPHONEOS_DEPLOYMENT_TARGET = 18.0; GENERATE_INFOPLIST_FILE = YES; '
            'INFOPLIST_FILE = CouncilStudio/Info.plist; TARGETED_DEVICE_FAMILY = 1; '
            'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_ENTITLEMENTS = CouncilStudio/CouncilStudio.entitlements; '
            'MARKETING_VERSION = 0.3.14; CURRENT_PROJECT_VERSION = 20; CODE_SIGN_STYLE = Automatic;')
widget_settings = ('PRODUCT_BUNDLE_IDENTIFIER = org.personalcouncil.next.studio.widgets; PRODUCT_NAME = CouncilWidgets; '
                   'SWIFT_VERSION = 6.0; IPHONEOS_DEPLOYMENT_TARGET = 18.0; GENERATE_INFOPLIST_FILE = YES; '
                   'INFOPLIST_FILE = CouncilWidgets/Info.plist; TARGETED_DEVICE_FAMILY = 1; '
                   'CODE_SIGN_ENTITLEMENTS = CouncilWidgets/CouncilWidgets.entitlements; '
                   'APPLICATION_EXTENSION_API_ONLY = YES; SKIP_INSTALL = YES; '
                   'SWIFT_ACTIVE_COMPILATION_CONDITIONS = COUNCIL_WIDGET; '
                   'MARKETING_VERSION = 0.3.14; CURRENT_PROJECT_VERSION = 20; CODE_SIGN_STYLE = Automatic;')
configs, pconfigs, widget_configs = [], [], []
for name in ['Debug', 'Release']:
    configs.append(obj('target' + name, f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ {settings} }};'))
    widget_configs.append(obj('widgettarget' + name, f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ {widget_settings} }};'))
    pconfigs.append(obj('project' + name, f'isa = XCBuildConfiguration; name = {name}; buildSettings = {{ SDKROOT = iphoneos; CLANG_ENABLE_MODULES = YES; }};'))
targetlist = obj('targetlist', f'isa = XCConfigurationList; buildConfigurations = ({",".join(configs)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
projectlist = obj('projectlist', f'isa = XCConfigurationList; buildConfigurations = ({",".join(pconfigs)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
widget_targetlist = obj('widgettargetlist', f'isa = XCConfigurationList; buildConfigurations = ({",".join(widget_configs)}); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
widget_target = obj('widgettarget', f'isa = PBXNativeTarget; name = CouncilWidgets; buildConfigurationList = {widget_targetlist}; buildPhases = ({widget_sourcephase},{widget_frameworks}); buildRules = (); dependencies = (); packageProductDependencies = ({widget_package}); productName = CouncilWidgets; productReference = {widget_product}; productType = "com.apple.product-type.app-extension";')
widget_proxy = obj('widgetproxy', f'isa = PBXContainerItemProxy; containerPortal = {uid("project")}; proxyType = 1; remoteGlobalIDString = {widget_target}; remoteInfo = CouncilWidgets;')
widget_dependency = obj('widgetdependency', f'isa = PBXTargetDependency; target = {widget_target}; targetProxy = {widget_proxy};')
target = obj('target', f'isa = PBXNativeTarget; name = CouncilStudio; buildConfigurationList = {targetlist}; buildPhases = ({sourcephase},{resourcephase},{frameworkphase},{embed_phase}); buildRules = (); dependencies = ({widget_dependency}); packageProductDependencies = ({packageproduct}); productName = CouncilStudio; productReference = {product}; productType = "com.apple.product-type.application";')
project = obj('project', f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2700; }}; buildConfigurationList = {projectlist}; compatibilityVersion = "Xcode 14.0"; developmentRegion = zh_CN; hasScannedForEncodings = 0; knownRegions = (en,zh_CN,Base); mainGroup = {group}; packageReferences = ({package}); projectDirPath = ""; projectRoot = ""; targets = ({target},{widget_target});')
folder = root / 'CouncilStudio.xcodeproj'
folder.mkdir(exist_ok=True)
(folder / 'project.pbxproj').write_text('// !$*UTF8*$!\n{ archiveVersion = 1; classes = {}; objectVersion = 56; objects = {\n' + '\n'.join(objects) + f'\n}}; rootObject = {project}; }}\n')
schemes = folder / 'xcshareddata/xcschemes'
schemes.mkdir(parents=True, exist_ok=True)
(schemes / 'CouncilStudio.xcscheme').write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3"><BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="CouncilStudio.app" BlueprintName="CouncilStudio" ReferencedContainer="container:CouncilStudio.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction><LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="CouncilStudio.app" BlueprintName="CouncilStudio" ReferencedContainer="container:CouncilStudio.xcodeproj"/></BuildableProductRunnable></LaunchAction></Scheme>
''')
print('generated', len(sources), 'sources')
