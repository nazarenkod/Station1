import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {listDependencies} from '../../app/common/node/source/repo.js';
import {
  agentWorkspace,
  codeMap,
  dependencyCode,
  describeDependencies,
  hostOf,
  isOwnDependency,
  joinPath,
  mergeDependencies,
  parseGradleSettings,
  parsePackageResolved,
  parsePackageSwift,
  parsePbxPackages,
  parsePodfileLock,
  sameUrl,
} from '../../app/common/shared/settings/dependencies.js';

const ORIGIN = 'git@git.bank.ua:mob/ios/p24.git';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

vi.mock('../../app/common/node/doctor/exec.js', async (importOriginal) => ({
  ...(await importOriginal()),
  shellEnv: async () => GIT_ENV,
}));

describe('addresses', () => {
  it('reads the host of every way git writes an address, none for a local one', () => {
    expect(hostOf('git@git.bank.ua:mob/core.git')).toBe('git.bank.ua');
    expect(hostOf('ssh://git@git.bank.ua:2222/mob/core.git')).toBe('git.bank.ua');
    expect(hostOf('https://github.com/Alamofire/Alamofire.git')).toBe('github.com');
    expect(hostOf('../core')).toBeNull();
    expect(hostOf('file:///Users/qa/core')).toBeNull();
  });

  it('meets the same repository however it is written', () => {
    expect(sameUrl('https://github.com/Alamofire/Alamofire.git')).toBe(sameUrl('git@github.com:alamofire/alamofire'));
  });

  it('joins a relative path to the folder of the file that names it', () => {
    expect(joinPath('/code/p24/App', '../Packages/Core')).toBe('/code/p24/Packages/Core');
    expect(joinPath('/code/p24', './Local')).toBe('/code/p24/Local');
    expect(joinPath('/code/p24', '/opt/Kit')).toBe('/opt/Kit');
  });
});

describe('Swift Package Manager', () => {
  it('reads the pins of Package.resolved v1 and v2', () => {
    const v2 = JSON.stringify({
      pins: [
        {
          identity: 'pbcore',
          kind: 'remoteSourceControl',
          location: 'git@git.bank.ua:mob/ios/pbcore.git',
          state: {branch: 'develop', revision: 'abcdef1234567'},
        },
        {identity: 'alamofire', location: 'https://github.com/Alamofire/Alamofire.git', state: {version: '5.9.1'}},
        {identity: 'snap', location: 'https://github.com/x/snap.git', state: {revision: '1234567890'}},
      ],
      version: 2,
    });
    expect(parsePackageResolved(v2)).toEqual([
      {name: 'pbcore', url: 'git@git.bank.ua:mob/ios/pbcore.git', version: 'develop'},
      {name: 'alamofire', url: 'https://github.com/Alamofire/Alamofire.git', version: '5.9.1'},
      {name: 'snap', url: 'https://github.com/x/snap.git', version: '1234567'},
    ]);
    const v1 = JSON.stringify({
      object: {
        pins: [
          {package: 'Kingfisher', repositoryURL: 'https://github.com/onevcat/Kingfisher', state: {version: '7.0.0'}},
        ],
      },
      version: 1,
    });
    expect(parsePackageResolved(v1)).toEqual([
      {name: 'Kingfisher', url: 'https://github.com/onevcat/Kingfisher', version: '7.0.0'},
    ]);
    expect(parsePackageResolved('not json')).toEqual([]);
  });

  it('finds remote and local packages in an Xcode project', () => {
    const pbx = `
/* Begin XCLocalSwiftPackageReference section */
		A1 /* XCLocalSwiftPackageReference "Packages/Auth" */ = {
			isa = XCLocalSwiftPackageReference;
			relativePath = Packages/Auth;
		};
		A2 /* XCLocalSwiftPackageReference "../ConfirmCore" */ = {
			isa = XCLocalSwiftPackageReference;
			relativePath = "../ConfirmCore";
		};
/* End XCLocalSwiftPackageReference section */
/* Begin XCRemoteSwiftPackageReference section */
		B1 /* XCRemoteSwiftPackageReference "pbcore" */ = {
			isa = XCRemoteSwiftPackageReference;
			repositoryURL = "git@git.bank.ua:mob/ios/pbcore.git";
			requirement = {
				branch = develop;
				kind = branch;
			};
		};
		B2 /* XCRemoteSwiftPackageReference "Alamofire" */ = {
			isa = XCRemoteSwiftPackageReference;
			repositoryURL = "https://github.com/Alamofire/Alamofire.git";
			requirement = {
				kind = upToNextMajorVersion;
				minimumVersion = 5.8.0;
			};
		};
/* End XCRemoteSwiftPackageReference section */`;
    expect(parsePbxPackages(pbx)).toEqual({
      local: [{path: 'Packages/Auth'}, {path: '../ConfirmCore'}],
      remote: [
        {url: 'git@git.bank.ua:mob/ios/pbcore.git', version: 'develop'},
        {url: 'https://github.com/Alamofire/Alamofire.git', version: '5.8.0'},
      ],
    });
  });

  it('finds the packages of a Package.swift', () => {
    const manifest = `
let package = Package(
  dependencies: [
    .package(path: "../TapAndPay"),
    .package(url: "git@git.bank.ua:mob/ios/pbthemes.git", branch: "develop"),
    .package(url: "https://github.com/pointfreeco/swift-snapshot-testing", from: "1.15.0"),
    .package(name: "Old", url: "https://github.com/x/old.git", "1.0.0"..<"2.0.0"),
  ]
)`;
    expect(parsePackageSwift(manifest)).toEqual({
      local: [{path: '../TapAndPay'}],
      remote: [
        {url: 'git@git.bank.ua:mob/ios/pbthemes.git', version: 'develop'},
        {url: 'https://github.com/pointfreeco/swift-snapshot-testing', version: '1.15.0'},
        {url: 'https://github.com/x/old.git', version: '1.0.0'},
      ],
    });
  });
});

describe('CocoaPods', () => {
  it('reads the pods from git, a path and the spec repositories, with their versions', () => {
    const lock = `PODS:
  - Alamofire (5.9.1)
  - Firebase/Analytics (10.0.0):
    - FirebaseAnalytics
  - P24Core (2.3.0)
  - PBThemes (1.0.0)
  - Tap (0.1.0)

DEPENDENCIES:
  - Alamofire

SPEC REPOS:
  "git@git.bank.ua:mob/ios/specs.git":
    - PBThemes
  trunk:
    - Alamofire
    - Firebase

EXTERNAL SOURCES:
  P24Core:
    :branch: develop
    :git: git@git.bank.ua:mob/ios/p24core.git
  Tap:
    :path: "../Tap"

CHECKOUT OPTIONS:
  P24Core:
    :commit: 0123456789abcdef
    :git: git@git.bank.ua:mob/ios/p24core.git

PODFILE CHECKSUM: abc

COCOAPODS: 1.15.2
`;
    expect(parsePodfileLock(lock)).toEqual([
      {name: 'P24Core', url: 'git@git.bank.ua:mob/ios/p24core.git', path: null, specRepo: null, version: 'develop'},
      {name: 'Tap', url: null, path: '../Tap', specRepo: null, version: '0.1.0'},
      {name: 'PBThemes', url: null, path: null, specRepo: 'git@git.bank.ua:mob/ios/specs.git', version: '1.0.0'},
      {name: 'Alamofire', url: null, path: null, specRepo: 'trunk', version: '5.9.1'},
      {name: 'Firebase', url: null, path: null, specRepo: 'trunk', version: '10.0.0'},
    ]);
  });
});

describe('Gradle', () => {
  it('finds the modules taken from outside the repository', () => {
    const settings = `
includeBuild("../build-logic")
includeBuild '../p24-kit'
// includeBuild("../commented")
include ':core'
project(':core').projectDir = new File(settingsDir, '../core/android')
project(":auth").projectDir = file("../auth")
`;
    expect(parseGradleSettings(settings)).toEqual([
      {name: 'build-logic', path: '../build-logic'},
      {name: 'p24-kit', path: '../p24-kit'},
      {name: 'core', path: '../core/android'},
      {name: 'auth', path: '../auth'},
    ]);
  });
});

describe('which code is the team’s and where it is', () => {
  it('keeps the same package from two files once, with the version that is known', () => {
    const merged = mergeDependencies([
      {kind: 'spm', key: 'spm:pbcore', name: 'pbcore', url: 'git@git.bank.ua:mob/ios/pbcore.git', version: null},
      {kind: 'spm', key: 'spm:pbcore', name: 'pbcore', url: 'ssh://git@git.bank.ua/mob/ios/pbcore', version: 'develop'},
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].version).toBe('develop');
  });

  it('tells the team’s code from libraries of others by the host of origin', () => {
    expect(isOwnDependency({kind: 'spm', url: 'git@git.bank.ua:mob/ios/pbcore.git'}, ORIGIN)).toBe(true);
    expect(isOwnDependency({kind: 'spm', url: 'https://github.com/Alamofire/Alamofire.git'}, ORIGIN)).toBe(false);
    expect(isOwnDependency({kind: 'pod', specRepo: 'trunk'}, ORIGIN)).toBe(false);
    expect(isOwnDependency({kind: 'pod', specRepo: 'git@git.bank.ua:mob/ios/specs.git'}, ORIGIN)).toBe(true);
    expect(isOwnDependency({kind: 'gradle', local: true}, ORIGIN)).toBe(true);
    expect(isOwnDependency({kind: 'submodule', url: '../auth'}, ORIGIN)).toBe(true);
    expect(isOwnDependency({kind: 'spm', url: 'https://github.com/x/y.git'}, null)).toBe(true);
  });

  it('takes the code from a folder of its own, where the project keeps it, or has none', () => {
    const remote = {kind: 'spm', key: 'spm:pbcore', present: false, folder: null};
    expect(dependencyCode(remote, {root: '/code/p24'})).toEqual({status: 'none', folder: null});
    expect(dependencyCode(remote, {root: '/code/p24', own: {'spm:pbcore': '/code/pbcore'}})).toEqual({
      status: 'own',
      folder: '/code/pbcore',
    });
    const local = {kind: 'spm', key: 'spm:auth', present: true, folder: '/code/p24/Packages/Auth'};
    expect(dependencyCode(local, {root: '/code/p24'})).toEqual({status: 'found', folder: '/code/p24/Packages/Auth'});
    // a submodule not loaded comes from the folder set for the submodule above it
    const tree = [
      {path: 'ap24f', depth: 0, parent: null},
      {path: 'ap24f/core-kit', depth: 1, parent: 'ap24f'},
    ];
    const nested = {kind: 'submodule', key: 'ap24f/core-kit', path: 'ap24f/core-kit', initialized: false};
    expect(dependencyCode(nested, {root: '/code/and', own: {ap24f: '/code/ap24f'}, tree})).toEqual({
      status: 'found',
      folder: '/code/ap24f/core-kit',
    });
  });

  it('puts the team’s dependencies first, by kind', () => {
    const state = {
      ok: true,
      root: '/code/p24',
      remote: ORIGIN,
      dependencies: [
        {kind: 'spm', key: 'spm:alamofire', name: 'alamofire', url: 'https://github.com/Alamofire/Alamofire.git'},
        {kind: 'pod', key: 'pod:p24core', name: 'P24Core', url: 'git@git.bank.ua:mob/ios/p24core.git'},
        {kind: 'spm', key: 'spm:pbcore', name: 'pbcore', url: 'git@git.bank.ua:mob/ios/pbcore.git'},
      ],
    };
    expect(describeDependencies(state).map((dep) => [dep.name, dep.own])).toEqual([
      ['pbcore', true],
      ['P24Core', true],
      ['alamofire', false],
    ]);
  });
});

describe('the code the agent gets', () => {
  const source = {repos: [{id: 'ios', name: 'p24-ios', platform: 'ios'}]};
  const states = {
    ios: {
      ok: true,
      root: '/code/p24',
      remote: ORIGIN,
      dependencies: [
        {kind: 'spm', key: 'spm:auth', name: 'Auth', local: true, present: true, folder: '/code/p24/Packages/Auth'},
        {kind: 'spm', key: 'spm:pbcore', name: 'pbcore', url: 'git@git.bank.ua:mob/ios/pbcore.git', present: false},
        {kind: 'spm', key: 'spm:themes', name: 'themes', url: 'git@git.bank.ua:mob/ios/themes.git', present: false},
        {
          kind: 'spm',
          key: 'spm:alamofire',
          name: 'alamofire',
          url: 'https://github.com/Alamofire/Alamofire.git',
          present: false,
        },
      ],
    },
  };
  const paths = {
    ios: {path: '/code/p24', modules: {'spm:pbcore': '/code/pbcore', 'spm:alamofire': '/code/alamofire'}},
  };

  it('opens the team’s dependencies with code, never libraries of others', () => {
    const workspace = agentWorkspace(source, paths, states);
    expect(workspace.cwd).toBe('/code/p24');
    expect(workspace.additionalDirectories).toEqual(['/code/p24/Packages/Auth', '/code/pbcore']);
  });

  it('gives the agent a map of the code, a line each', () => {
    const {map} = agentWorkspace(source, paths, states);
    expect(codeMap(map)).toBe(
      [
        '- p24-ios (repository): /code/p24',
        '- Auth (Swift package): /code/p24/Packages/Auth',
        '- pbcore (Swift package): /code/pbcore',
      ].join('\n'),
    );
  });
});

describe('the dependencies of a repository on disk', () => {
  let dir;
  const write = (file, text) => {
    mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
    writeFileSync(path.join(dir, file), text);
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'station-deps-'));
    execFileSync('git', ['init', '-q', 'app'], {cwd: dir, env: GIT_ENV});
    // an iOS app: an Xcode project with a local and a remote package, its pins ignored by git
    write('app/.gitignore', 'Package.resolved\n');
    write(
      'app/P24.xcodeproj/project.pbxproj',
      [
        '\t\tA1 = {',
        '\t\t\tisa = XCLocalSwiftPackageReference;',
        '\t\t\trelativePath = Packages/Auth;',
        '\t\t};',
        '\t\tB1 = {',
        '\t\t\tisa = XCRemoteSwiftPackageReference;',
        '\t\t\trepositoryURL = "git@git.bank.ua:mob/ios/pbcore.git";',
        '\t\t};',
        '',
      ].join('\n'),
    );
    write(
      'app/P24.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
      JSON.stringify({
        pins: [{identity: 'pbcore', location: 'git@git.bank.ua:mob/ios/pbcore.git', state: {version: '3.1.0'}}],
      }),
    );
    write('app/Packages/Auth/Package.swift', '// swift-tools-version:5.9\n');
    // pods: one from a path beside the app, one installed from the trunk
    write(
      'app/Podfile.lock',
      'PODS:\n  - Alamofire (5.9.1)\n  - Tap (0.1.0)\n\nSPEC REPOS:\n  trunk:\n    - Alamofire\n\nEXTERNAL SOURCES:\n  Tap:\n    :path: "../Tap"\n\n',
    );
    write('app/Pods/Alamofire/Source.swift', '');
    // a Gradle build taken from beside the repository, and one inside it that is not a dependency
    write('app/settings.gradle', "includeBuild('../kit')\nincludeBuild('build-logic')\n");
    write('kit/build.gradle', '');
    execFileSync('git', ['add', '-A'], {cwd: path.join(dir, 'app'), env: GIT_ENV});
  });

  afterAll(() => rmSync(dir, {recursive: true, force: true}));

  it('finds the Swift packages, pods and Gradle modules, and whether their code is here', async () => {
    const root = path.join(dir, 'app');
    const deps = await listDependencies(root);
    const brief = Object.fromEntries(deps.map((dep) => [dep.key, [dep.version ?? null, dep.present, dep.folder]]));
    expect(brief).toEqual({
      'spm:pbcore': ['3.1.0', false, null],
      'spm:auth': [null, true, path.join(root, 'Packages/Auth')],
      'pod:tap': [null, false, path.join(dir, 'Tap')],
      'pod:alamofire': ['5.9.1', true, path.join(root, 'Pods/Alamofire')],
      'gradle:kit': [null, true, path.join(dir, 'kit')],
    });
  });
});
