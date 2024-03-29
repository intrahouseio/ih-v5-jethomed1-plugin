/**
 * app.js
 */

const util = require('util');
const fs = require('fs');
const fsPromises = require('fs').promises;

module.exports = function (plugin) {
  const w1folder = '/sys/bus/w1/devices/';
  const gpiofolder = '/sys/class/gpio/';
  const period_t = plugin.params.data.period_t || 10000; 
  const period_d = plugin.params.data.period_d || 1000;
  const channels = []; // Плагин имеет свои каналы
  let T1, T2;
  let devList = [];
  
  sendChannels(); // Отправить каналы на старте
  sendNext();
  sendNext_t();

  function sendChannels() {
    // Определить папки в каналах
    channels.push({id: 'inputs', title: 'inputs', folder: 1});
    channels.push({id: 'relays', title: 'relays', folder: 1});
    channels.push({id: '1-wire', title: '1-wire', folder: 1});
    channels.push({id: 'leds', title: 'leds', folder: 1});
    channels.push({id: 'buttons', title: 'buttons', folder: 1});

    // Определить свои каналы
    channels.push({ id: 'DI1', desc: 'DI', gpio: 'gpio472', value: 0, parent: 'inputs', r: 1 });
    channels.push({ id: 'DI2', desc: 'DI', gpio: 'gpio471', value: 0, parent: 'inputs', r: 1 });
    channels.push({ id: 'DI3', desc: 'DI', gpio: 'gpio470', value: 0, parent: 'inputs', r: 1 });
    channels.push({ id: 'DI4', desc: 'DI', gpio: 'gpio469', value: 0, parent: 'inputs', r: 1 });
    channels.push({ id: 'BTN_usr', desc: 'DI', gpio: 'gpio436', value: 0, parent: 'buttons', r: 1 });
    channels.push({ id: 'DO1', desc: 'DO', gpio: 'gpio456', value: 0, parent: 'relays', r: 1, w: 1 });
    channels.push({ id: 'DO2', desc: 'DO', gpio: 'gpio455', value: 0, parent: 'relays', r: 1, w: 1 });
    channels.push({ id: 'DO3', desc: 'DO', gpio: 'gpio454', value: 0, parent: 'relays', r: 1, w: 1 });
    channels.push({ id: 'LED_red', desc: 'DO', gpio: 'gpio452', value: 0, parent: 'leds', r: 1, w: 1 });
    channels.push({ id: 'LED_green', desc: 'DO', gpio: 'gpio453', value: 0, parent: 'leds', r: 1, w: 1 });
    
    // Просканировать подключенные датчики 1-wire
    if (!fs.existsSync(w1folder)) {
      plugin.log('ADAPTER: Not found ' + w1folder + '. 1-wire driver is not installed!', 1);
    } else {
      devList = getDevList();
      if (devList.length>0) {
        for (let i = 0; i<devList.length; i++) {
          channels.push({ id: devList[i], desc: 'AI', parent: '1-wire', r: 1 });
        }
      }
      plugin.log('1-wire devices: ' + devList, 1);
    }

    // Отправить каналы на сервер
    plugin.send({ type: 'channels', data: channels });
  }

  function isDS18B20Sensor(name) {
    return (name && (name.substr(0, 2) == '28'));
  }

  function getDevList() {
    let arr = [];
    let stats;

    try {
      let filelist = fs.readdirSync(w1folder);
      if (!util.isArray(filelist)) {
        throw { message: "" };
      }

      for (var i = 0; i < filelist.length; i++) {
        if (!isDS18B20Sensor(filelist[i])) continue;

        stats = fs.statSync(w1folder + "/" + filelist[i]);
        if (stats.isDirectory()) {
          arr.push(filelist[i]);
        }
      }
      return arr;

    } catch (e) {
      logger.log("Error reading folder " + w1folder + ". " + e.message, 1);
      process.exit();
    }
  }

async function sendNext() {
    await readDiscrets();
    T1 = setTimeout(sendNext, period_d); 
  }
  
async function sendNext_t() {
    await read1wire();
    T2 = setTimeout(sendNext_t, period_t); 
  }

async function read1wire() {
  let filename, value;
	for (let i=0; i<channels.length; i++) {
          if (channels[i].desc == 'AI') {
	    filename = w1folder+channels[i].id+'/w1_slave';
	   
	//if ( isDS18B20Sensor( channels[i].id )) {
		value = null;
		try {
		 // if (fs.statSync(filename).isFile()) 	{
			  // Открыть файл, читать значение
			  value = await fsPromises.readFile(filename);
		    value = readTemp(value);
      //}
		} catch (e) {
		  plugin.log('ERR: '+e.message, 1);
		  plugin.sendData([{id:channels[i].id, chstatus:1}]);
		  continue;
		}
    plugin.sendData([{id:channels[i].id, value: value, chstatus: value == null ? 1 : 0}]);
	//}
          }
          if (channels[i].desc == 'DO') {
            filename = gpiofolder+channels[i].gpio+'/value';
            value = await fsPromises.readFile(filename);
            value = parseInt(value.toString());
	    plugin.sendData([{id:channels[i].id, value}]);
          }	
	}
	clearTimeout(T2); value = null; filename = null;
    }	

function readTemp(data) {	
    let j, result;

	data = data.toString();
	if (data.indexOf('YES') > 0) {
	    j = data.indexOf('t=')
	    if (j>0) {
		result = parseInt(data.substr(j+2))/1000;
	    }	
	} 
	return result
    }

async function readDiscrets() {
  let value;
  for (let i =0; i<channels.length; i++) {
    if (channels[i].desc == 'DI') {
      value = await fsPromises.readFile(gpiofolder+channels[i].gpio+'/value');
      value = parseInt(value.toString());
      if (value != channels[i].value) {
        plugin.sendData([{id: channels[i].id, value: value}]);
        channels[i].value = value;
      }
    }
  }
  clearTimeout(T1); value = null;
  //plugin.log("Read Time: " + end)
}

function write(datawrite) {
    try {
      const result = [];
      datawrite.forEach(item => {
        if (item.id) {
          const chanObj = channels.find(chanItem => chanItem.id == item.id);
          if (chanObj) {
	          if (isNaN(item.value)) return
            chanObj.value = item.value;
            result.push({ id: item.id, value: item.value })
	          fsPromises.writeFile(gpiofolder+chanObj.gpio+'/value', Number(chanObj.value) ? '1' : '0');
          } else {
            plugin.log('Not found channel with id ' + item.id, 1)
          }
        }
      });

    // Сразу отправляем на сервер
    if (result.length) plugin.sendData(result);
    plugin.log('Write completed' + util.inspect(result), 1);
    } catch (e) {
      plugin.log('Write ERROR: ' + util.inspect(e), 1);
    }
  }

  function terminate() {
    plugin.log('TERMINATE PLUGIN');
    // Здесь закрыть все что нужно
  }

  // Получили команды управления от сервера
  plugin.onAct(message => {
    plugin.log('Action data=' + util.inspect(message), 1);
    if (!message.data) return;
    write(message.data);
  });


  process.on('exit', terminate);
  process.on('SIGTERM', () => {
    terminate();
    process.exit(0);
  });
};
