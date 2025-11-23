<?php

declare(strict_types=1);

use OCP\Util;

Util::addScript(OCA\Compass\AppInfo\Application::APP_ID, OCA\Compass\AppInfo\Application::APP_ID . '-main');
Util::addStyle(OCA\Compass\AppInfo\Application::APP_ID, OCA\Compass\AppInfo\Application::APP_ID . '-main');

?>

<div id="compass"></div>
