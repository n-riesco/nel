# Contributing to `NEL`

First of all, thank you for taking the time to contribute.

Here, you will find relevant information for contributing to this project.

## Issue tracker

Please, feel free to use the [issue
tracker](https://github.com/n-riesco/nel/issues) to report any problems
you encounter or any enhancements you would like to see implemented. To
facilitate the process of fixing a problem, please, include the following
information in your report:

- `nel` version. Please, run the command:

```sh
npm list nel
```

- npm version:

```sh
npm version
```

- Operating system. In most modern linux distributions, it is enough to run:

```sh
lsb_release -sd
```

## Code contributions

- Please, open an issue in the [issue
  tracker](https://github.com/n-riesco/nel/issues).

- Pull requests will be distributed under the terms in the LICENSE file. Hence,
  before accepting any pull requests, it is important that the copyright holder
  of a pull request acknowledges their consent. To express this consent, please,
  ensure the AUTHORS file has been updated accordingly.

## Coding guidelines

- For the sake of readability, please, ensure the coding style of your pull
  requests is consistent with this project: lowerCamelCaseNaming,
  CONSTANTS_NAMING, 4-space indent, collapsed brackets...

- The source code in `nel` is annotated using
  [JSDoc](https://github.com/jsdoc3/jsdoc). Running the command:

  ```sh
  npm run doc
  ```
  will generate the JSDoc documentation in folder `doc`.
