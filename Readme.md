# sync-sdb

  SimpleDB Backbone Sync adapter (for Express / Connect)

## Installation

via npm:

    $ npm install sync-sdb

## Options

  - `db` SDB object (optional if keyid & secret are passed)
  - `permissions` an object for the default read_write permission. (optional, default: {default_write: 'null', default_read : '*'})
  - `keyid` AWS Key (optional if db is passed)
  - `secret` AWS Secret (optional if db is passed)
  - `domains` Map between allowed collection names and sdb domain names. ex: {'^messages$' : 'messages'}


## Example

With express:

        app.all('/bb/*',  Auth.isAuthenticated, (new sync({
		domains : {
			'^message$' : 'message_test',
			'^farid.*' : 'farid'
		},
		keyid : 'YOUR_AWS_KEY',
		secret : 'YOUR_AWS_SECRET'
	})).sync)

## License 

(The MIT License)

Copyright (c) 2013 Farid Fadaie &lt;farid.fadaie@gmail.com&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
